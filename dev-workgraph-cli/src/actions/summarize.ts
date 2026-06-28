// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { loadConfig, repoCommitsDir, repoSummariesDir, setOllamaConfig } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { commitEvidenceTimestamp, commitSummaryPath } from "../lib/grouping.js";
import {
  cleanQuestionAnalysis,
  enforceSignalReasons,
  type ModelLayer,
  modelJsonSchema,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildCommitUserPrompt,
  COMMIT_SUMMARY_SYSTEM,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type { CommitEvidenceRecord, CommitSummaryRecord } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";
import { compareLocale } from "../lib/sort.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `summarize` command.
 */
export interface SummarizeOptions {
  /** Path to the repository whose exported commits should be summarized. */
  repo: string;
  /** Ollama base URL override. */
  url?: string;
  /** Model name; skips the interactive picker when given. */
  model?: string;
  /** Only process the first N pending commits (useful for trials). */
  limit?: number;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

/**
 * Recursively lists every commit evidence JSON file under the commits directory.
 * @param dir - The commits directory.
 */
function listEvidenceJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      if (f.endsWith(".json")) files.push(path.join(sub, f));
    }
  }
  return files.sort(compareLocale);
}

/**
 * Fills the model layer of every pending commit record by querying Ollama.
 * @param options - Resolved command options.
 */
export async function summarize(options: SummarizeOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const evidenceDir = repoCommitsDir(repoPath, options.period);
  const summariesDir = repoSummariesDir(repoPath, options.period);
  const baseUrl = resolveBaseUrl(options.url);

  const allFiles = listEvidenceJsonFiles(evidenceDir);
  if (allFiles.length === 0) {
    console.log(`No exported commits found for ${repoPath}. Run \`dev-workgraph evidence\` first.`);
    return;
  }

  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should summarize commit patches?",
    saved: savedOllama?.commitModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, commitModel: model });
  console.log(`Using model "${model}" at ${baseUrl}\n`);

  const projectBlock = projectContextBlock(loadProjectContext(repoPath, options.period));
  if (!projectBlock) {
    console.log("⚠️  No project context (run `dev-workgraph init`); summarizing without it.\n");
  }
  const system = withProjectContext(projectBlock, COMMIT_SUMMARY_SYSTEM);

  // Pending = no summary file yet (append-only). Legacy evidence with inlined model counts as done.
  const pending: { evidence: CommitEvidenceRecord; summaryPath: string }[] = [];
  for (const file of allFiles) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CommitEvidenceRecord & {
      model?: ModelLayer | null;
    };
    const { model: legacyModel, ...evidence } = raw;
    const summaryPath = commitSummaryPath(summariesDir, evidence.timestamp, evidence.commitHash);
    if (fs.existsSync(summaryPath) || legacyModel) continue;
    pending.push({ evidence, summaryPath });
  }

  const total = allFiles.length;
  const skipped = total - pending.length;

  console.log(
    `${total} total · ${skipped} already summarized (skipped) · ${pending.length} pending.`,
  );

  const work = options.limit ? pending.slice(0, options.limit) : pending;
  if (work.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`Summarizing ${work.length} commit(s)...\n`);

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("summarize");

  let done = 0;
  let failed = 0;
  try {
    for (const [i, item] of work.entries()) {
      const short = item.evidence.commitHash.slice(0, 8);
      process.stdout.write(
        `[${i + 1}/${work.length}] ${short} ${item.evidence.title.slice(0, 50)} ... `,
      );

      const evidenceJsonPath = path.join(
        evidenceDir,
        String(item.evidence.timestamp),
        `${item.evidence.commitHash}.json`,
      );
      const patchPath = evidenceJsonPath.replace(/\.json$/, ".patch");
      const patch = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
      const { prompt, truncated } = buildCommitUserPrompt(item.evidence, patch);

      try {
        const raw = (await chatJson({
          baseUrl,
          model,
          system,
          user: prompt,
          schema: modelJsonSchema(),
          tracker,
        })) as ModelLayer;

        const layer = enforceSignalReasons(raw);
        layer.questionsAnalysis = cleanQuestionAnalysis(layer.questionsAnalysis);
        layer.provenance = {
          model,
          generatedAt: new Date().toISOString(),
          patchTruncated: truncated,
        };

        const summary: CommitSummaryRecord = {
          commitHash: item.evidence.commitHash,
          timestamp: item.evidence.timestamp,
          sourceEvidence: commitEvidenceTimestamp(item.evidence.timestamp),
          model: layer,
        };
        fs.mkdirSync(path.dirname(item.summaryPath), { recursive: true });
        writeRecordJson(item.summaryPath, summary);
        console.log("ok");
        done += 1;
      } catch (err) {
        console.log(`failed (${(err as Error).message})`);
        failed += 1;
      }
    }
  } finally {
    tracker.endStep();
  }

  console.log(`\n✅ Summarized ${done}, failed ${failed}. Summaries written to ${summariesDir}.`);
}
