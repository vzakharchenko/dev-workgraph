// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { loadConfig, repoCommitsDir, setOllamaConfig } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { enforceSignalReasons, type ModelLayer, modelJsonSchema } from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildCommitUserPrompt,
  COMMIT_SUMMARY_SYSTEM,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import type { CommitRecord } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";

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
  /** Re-summarize commits that already have a model layer. */
  force?: boolean;
  /** Only process the first N pending commits (useful for trials). */
  limit?: number;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

/**
 * Recursively lists every commit JSON file under the commits directory.
 * @param dir - The commits directory.
 */
function listCommitJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      if (f.endsWith(".json")) files.push(path.join(sub, f));
    }
  }
  return files.sort();
}

/**
 * Fills the model layer of every pending commit record by querying Ollama.
 * @param options - Resolved command options.
 */
export async function summarize(options: SummarizeOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const dir = repoCommitsDir(repoPath, options.period);
  const baseUrl = resolveBaseUrl(options.url);

  const allFiles = listCommitJsonFiles(dir);
  if (allFiles.length === 0) {
    console.log(`No exported commits found for ${repoPath}. Run \`dev-workgraph export\` first.`);
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

  // Pending = not yet summarized, unless --force.
  const pending: { file: string; record: CommitRecord }[] = [];
  for (const file of allFiles) {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as CommitRecord;
    if (record.model && !options.force) continue;
    pending.push({ file, record });
  }

  const total = allFiles.length;
  const skipped = total - pending.length; // 0 when --force (nothing is skipped)

  if (options.force) {
    console.log(`${total} total · re-summarizing all (--force).`);
  } else {
    console.log(
      `${total} total · ${skipped} already summarized (skipped) · ${pending.length} pending.`,
    );
  }

  const work = options.limit ? pending.slice(0, options.limit) : pending;
  if (work.length === 0) {
    console.log("Nothing to do. Use --force to re-summarize existing records.");
    return;
  }

  console.log(`Summarizing ${work.length} commit(s)...\n`);

  let done = 0;
  let failed = 0;
  for (const [i, item] of work.entries()) {
    const short = item.record.commitHash.slice(0, 8);
    process.stdout.write(
      `[${i + 1}/${work.length}] ${short} ${item.record.title.slice(0, 50)} ... `,
    );

    const patchPath = item.file.replace(/\.json$/, ".patch");
    const patch = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
    const { prompt, truncated } = buildCommitUserPrompt(item.record, patch);

    try {
      const raw = (await chatJson({
        baseUrl,
        model,
        system,
        user: prompt,
        schema: modelJsonSchema(),
      })) as ModelLayer;

      const layer = enforceSignalReasons(raw);
      layer.provenance = {
        model,
        generatedAt: new Date().toISOString(),
        patchTruncated: truncated,
      };

      item.record.model = layer;
      fs.writeFileSync(item.file, `${JSON.stringify(item.record, null, 2)}\n`, "utf8");
      console.log("ok");
      done += 1;
    } catch (err) {
      console.log(`failed (${(err as Error).message})`);
      failed += 1;
    }
  }

  console.log(`\n✅ Summarized ${done}, failed ${failed}. Records updated in ${dir}.`);
}
