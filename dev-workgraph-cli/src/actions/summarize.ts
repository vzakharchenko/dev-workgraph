// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { loadConfig, repoCommitsDir, repoSummariesDir, setOllamaConfig } from "../lib/config.js";
import { isCommitEvidenceManifestFile } from "../lib/evidence-files.js";
import { resolveRepo } from "../lib/git.js";
import { commitSummaryPath } from "../lib/grouping.js";
import {
  commitMergedSummaryPath,
  commitSummaryPartPath,
  mergePartSummaries,
} from "../lib/merge-commit-summary.js";
import {
  cleanQuestionAnalysis,
  emptyCommitModelLayer,
  enforceSignalReasons,
  type ModelLayer,
  mergeFinalizeQuestionsJsonSchema,
  mergeFinalizeReasonsJsonSchema,
  mergeFinalizeSummaryJsonSchema,
  modelJsonSchema,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { isEmptySummarizePatch } from "../lib/patch-split.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildCommitUserPrompt,
  buildMergeFinalizeQuestionsPrompt,
  buildMergeFinalizeReasonsPrompt,
  buildMergeFinalizeSummaryPrompt,
  COMMIT_SUMMARY_SYSTEM,
  MERGE_FINALIZE_QUESTIONS_SYSTEM,
  MERGE_FINALIZE_REASONS_SYSTEM,
  MERGE_FINALIZE_SUMMARY_SYSTEM,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type {
  CommitEvidencePartRecord,
  CommitEvidenceRecord,
  CommitSummaryRecord,
} from "../lib/records.js";
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

type PendingSingle = { kind: "single"; evidence: CommitEvidenceRecord };
type PendingSplit = { kind: "split"; evidence: CommitEvidenceRecord; partCount: number };
type PendingItem = PendingSingle | PendingSplit;

/**
 * Recursively lists every commit evidence manifest under the commits directory.
 * @param dir - The commits directory.
 */
function listEvidenceJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      if (isCommitEvidenceManifestFile(f)) files.push(path.join(sub, f));
    }
  }
  return files.sort(compareLocale);
}

function hasCanonicalSummary(summariesDir: string, evidence: CommitEvidenceRecord): boolean {
  return fs.existsSync(commitSummaryPath(summariesDir, evidence.timestamp, evidence.commitHash));
}

function classifyEvidenceFile(file: string, summariesDir: string): PendingItem | "skip" {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CommitEvidenceRecord & {
    model?: ModelLayer | null;
  };
  const { model: legacyModel, ...evidence } = raw;

  if (evidence.split) {
    const partCount = evidence.partCount ?? 0;
    if (partCount < 1 || hasCanonicalSummary(summariesDir, evidence)) return "skip";
    return { kind: "split", evidence, partCount };
  }

  if (hasCanonicalSummary(summariesDir, evidence) || legacyModel) return "skip";
  return { kind: "single", evidence };
}

function collectPending(
  allFiles: string[],
  summariesDir: string,
): { pending: PendingItem[]; skipped: number } {
  const pending: PendingItem[] = [];
  let skipped = 0;

  for (const file of allFiles) {
    const item = classifyEvidenceFile(file, summariesDir);
    if (item === "skip") {
      skipped += 1;
      continue;
    }
    pending.push(item);
  }

  return { pending, skipped };
}

function shouldSkipCommitSummarize(patch: string): boolean {
  return isEmptySummarizePatch(patch);
}

function allEvidencePatchesEmpty(evidenceDir: string, evidence: CommitEvidenceRecord): boolean {
  const ts = String(evidence.timestamp);
  const hash = evidence.commitHash;
  if (evidence.split) {
    const partCount = evidence.partCount ?? 0;
    for (let part = 1; part <= partCount; part += 1) {
      const partPatchPath = path.join(evidenceDir, ts, `${hash}.part${part}.patch`);
      const patch = fs.existsSync(partPatchPath) ? fs.readFileSync(partPatchPath, "utf8") : "";
      if (!isEmptySummarizePatch(patch)) return false;
    }
    return true;
  }
  const patchPath = path.join(evidenceDir, ts, `${hash}.patch`);
  const patch = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
  return isEmptySummarizePatch(patch);
}

async function summarizeOnePart(input: {
  baseUrl: string;
  model: string;
  system: string;
  evidenceDir: string;
  summariesDir: string;
  evidence: CommitEvidenceRecord;
  part: number;
  tracker: TokenUsageTracker;
}): Promise<ModelLayer> {
  const { baseUrl, model, system, evidenceDir, summariesDir, evidence, part, tracker } = input;
  const ts = String(evidence.timestamp);
  const hash = evidence.commitHash;
  const partEvidencePath = path.join(evidenceDir, ts, `${hash}.part${part}.json`);
  const partPatchPath = path.join(evidenceDir, ts, `${hash}.part${part}.patch`);
  const partEvidence = JSON.parse(
    fs.readFileSync(partEvidencePath, "utf8"),
  ) as CommitEvidencePartRecord;
  const patch = fs.existsSync(partPatchPath) ? fs.readFileSync(partPatchPath, "utf8") : "";

  if (shouldSkipCommitSummarize(patch)) {
    const layer = emptyCommitModelLayer();
    const partSummaryPath = commitSummaryPartPath(summariesDir, evidence.timestamp, hash, part);
    fs.mkdirSync(path.dirname(partSummaryPath), { recursive: true });
    writeRecordJson(partSummaryPath, {
      commitHash: hash,
      timestamp: evidence.timestamp,
      sourceEvidence: ts,
      model: layer,
    });
    console.log("skipped (empty patch)");
    return layer;
  }

  const prompt = buildCommitUserPrompt(partEvidence, patch);

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
  };

  const partSummaryPath = commitSummaryPartPath(summariesDir, evidence.timestamp, hash, part);
  fs.mkdirSync(path.dirname(partSummaryPath), { recursive: true });
  const summary: CommitSummaryRecord = {
    commitHash: hash,
    timestamp: evidence.timestamp,
    sourceEvidence: ts,
    model: layer,
  };
  writeRecordJson(partSummaryPath, summary);
  return layer;
}

async function finalizeMergedSummary(input: {
  baseUrl: string;
  model: string;
  projectBlock: string;
  evidenceDir: string;
  evidence: CommitEvidenceRecord;
  merged: ModelLayer;
  partCount: number;
  tracker: TokenUsageTracker;
}): Promise<ModelLayer> {
  const { baseUrl, model, projectBlock, evidenceDir, evidence, merged, partCount, tracker } = input;

  if (allEvidencePatchesEmpty(evidenceDir, evidence)) {
    console.log("  [3/6] polish signal reasons ... skipped (empty patch)");
    console.log("  [4/6] compose summary ... skipped (empty patch)");
    console.log("  [5/6] reframe questions (4) ... skipped (empty patch)");
    return emptyCommitModelLayer();
  }

  const areas = evidence.deterministic.areas;
  const signals = {
    technical: merged.technicalSignal,
    architecture: merged.architectureSignal,
    security: merged.securitySignal,
  };
  const sharedMeta = {
    title: evidence.title,
    partCount,
    signals,
    changeTypes: merged.changeTypes,
    technologies: merged.technologies,
    areas,
  };

  process.stdout.write("  [3/6] polish signal reasons ... ");
  const reasonsRaw = (await chatJson({
    baseUrl,
    model,
    system: withProjectContext(projectBlock, MERGE_FINALIZE_REASONS_SYSTEM),
    user: buildMergeFinalizeReasonsPrompt({
      ...sharedMeta,
      signalReasons: merged.signalReasons,
    }),
    schema: mergeFinalizeReasonsJsonSchema(),
    tracker,
  })) as { signalReasons: ModelLayer["signalReasons"] };
  const polishedReasons = enforceSignalReasons({
    ...merged,
    signalReasons: reasonsRaw.signalReasons,
  }).signalReasons;
  console.log("ok");

  process.stdout.write("  [4/6] compose summary ... ");
  const summaryRaw = (await chatJson({
    baseUrl,
    model,
    system: withProjectContext(projectBlock, MERGE_FINALIZE_SUMMARY_SYSTEM),
    user: buildMergeFinalizeSummaryPrompt({
      ...sharedMeta,
      rawSummary: merged.summary,
      signalReasons: polishedReasons,
    }),
    schema: mergeFinalizeSummaryJsonSchema(),
    tracker,
  })) as { summary: string };
  console.log("ok");

  process.stdout.write("  [5/6] reframe questions (4) ... ");
  const questionsRaw = (await chatJson({
    baseUrl,
    model,
    system: withProjectContext(projectBlock, MERGE_FINALIZE_QUESTIONS_SYSTEM),
    user: buildMergeFinalizeQuestionsPrompt({
      title: evidence.title,
      summary: summaryRaw.summary,
      signalReasons: polishedReasons,
      candidateQuestions: merged.questionsAnalysis,
    }),
    schema: mergeFinalizeQuestionsJsonSchema(),
    tracker,
  })) as { questionsAnalysis: ModelLayer["questionsAnalysis"] };
  const questionsAnalysis = cleanQuestionAnalysis(questionsRaw.questionsAnalysis).slice(0, 4);
  console.log("ok");

  return {
    ...merged,
    summary: summaryRaw.summary.trim(),
    signalReasons: polishedReasons,
    questionsAnalysis,
    provenance: {
      model,
      generatedAt: new Date().toISOString(),
    },
  };
}

function writeCanonicalSummary(input: {
  summariesDir: string;
  evidence: CommitEvidenceRecord;
  model: ModelLayer;
}): string {
  const summaryPath = commitSummaryPath(
    input.summariesDir,
    input.evidence.timestamp,
    input.evidence.commitHash,
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  const summary: CommitSummaryRecord = {
    commitHash: input.evidence.commitHash,
    timestamp: input.evidence.timestamp,
    sourceEvidence: String(input.evidence.timestamp),
    model: input.model,
  };
  writeRecordJson(summaryPath, summary);
  return summaryPath;
}

interface SplitCommitContext {
  commitIndex: number;
  commitTotal: number;
  baseUrl: string;
  model: string;
  system: string;
  projectBlock: string;
  evidenceDir: string;
  summariesDir: string;
  evidence: CommitEvidenceRecord;
  partCount: number;
  tracker: TokenUsageTracker;
  mergeFile: string;
  canonicalFile: string;
}

function writeSplitCanonicalAndDone(ctx: SplitCommitContext, model: ModelLayer): void {
  process.stdout.write(`  [6/6] wrote ${ctx.canonicalFile} ... `);
  writeCanonicalSummary({
    summariesDir: ctx.summariesDir,
    evidence: ctx.evidence,
    model,
  });
  console.log("ok");
  console.log("  done");
}

function handleEmptySplitCommit(ctx: SplitCommitContext): void {
  console.log("  [1/6] summarizing parts ... skipped (empty patch)");
  console.log(`  [2/6] merging part summaries → ${ctx.mergeFile} ... skipped (empty patch)`);
  writeSplitCanonicalAndDone(ctx, emptyCommitModelLayer());
}

async function summarizeSplitParts(ctx: SplitCommitContext): Promise<ModelLayer[]> {
  const partLayers: ModelLayer[] = [];
  for (let part = 1; part <= ctx.partCount; part += 1) {
    const partSummaryPath = commitSummaryPartPath(
      ctx.summariesDir,
      ctx.evidence.timestamp,
      ctx.evidence.commitHash,
      part,
    );
    if (fs.existsSync(partSummaryPath)) {
      const record = JSON.parse(fs.readFileSync(partSummaryPath, "utf8")) as CommitSummaryRecord;
      partLayers.push(record.model);
      console.log(`    [${part}/${ctx.partCount}] part ${part} ... skipped (already present)`);
      continue;
    }

    process.stdout.write(`    [${part}/${ctx.partCount}] part ${part} ... `);
    const layer = await summarizeOnePart({
      baseUrl: ctx.baseUrl,
      model: ctx.model,
      system: ctx.system,
      evidenceDir: ctx.evidenceDir,
      summariesDir: ctx.summariesDir,
      evidence: ctx.evidence,
      part,
      tracker: ctx.tracker,
    });
    partLayers.push(layer);
    console.log("ok");
  }
  return partLayers;
}

async function resolveSplitMergedModel(ctx: SplitCommitContext): Promise<ModelLayer> {
  const mergePath = commitMergedSummaryPath(
    ctx.summariesDir,
    ctx.evidence.timestamp,
    ctx.evidence.commitHash,
  );

  if (fs.existsSync(mergePath)) {
    console.log("  [1/6] summarizing parts ... skipped (merge present)");
    console.log(`  [2/6] merging part summaries → ${ctx.mergeFile} ... skipped (already present)`);
    const mergeRecord = JSON.parse(fs.readFileSync(mergePath, "utf8")) as CommitSummaryRecord;
    return mergeRecord.model;
  }

  console.log("  [1/6] summarizing parts ...");
  const partLayers = await summarizeSplitParts(ctx);

  process.stdout.write(`  [2/6] merging part summaries → ${ctx.mergeFile} ... `);
  writeMergedSummary({
    summariesDir: ctx.summariesDir,
    evidence: ctx.evidence,
    partLayers,
    model: ctx.model,
  });
  console.log("ok");

  const mergeRecord = JSON.parse(fs.readFileSync(mergePath, "utf8")) as CommitSummaryRecord;
  return mergeRecord.model;
}

async function summarizeSplitCommit(input: SplitCommitContext): Promise<void> {
  const short = input.evidence.commitHash.slice(0, 8);
  console.log(
    `[${input.commitIndex}/${input.commitTotal}] ${short} ${input.evidence.title.slice(0, 50)}`,
  );
  console.log(`  split mode · ${input.partCount} parts`);

  if (allEvidencePatchesEmpty(input.evidenceDir, input.evidence)) {
    handleEmptySplitCommit(input);
    return;
  }

  const mergedModel = await resolveSplitMergedModel(input);
  const finalModel = await finalizeMergedSummary({
    baseUrl: input.baseUrl,
    model: input.model,
    projectBlock: input.projectBlock,
    evidenceDir: input.evidenceDir,
    evidence: input.evidence,
    merged: mergedModel,
    partCount: input.partCount,
    tracker: input.tracker,
  });

  writeSplitCanonicalAndDone(input, finalModel);
}

function writeMergedSummary(input: {
  summariesDir: string;
  evidence: CommitEvidenceRecord;
  partLayers: ModelLayer[];
  model: string;
}): void {
  const mergedModel = mergePartSummaries(input.partLayers);
  mergedModel.provenance = {
    model: input.model,
    generatedAt: new Date().toISOString(),
  };

  const mergePath = commitMergedSummaryPath(
    input.summariesDir,
    input.evidence.timestamp,
    input.evidence.commitHash,
  );
  fs.mkdirSync(path.dirname(mergePath), { recursive: true });
  const summary: CommitSummaryRecord = {
    commitHash: input.evidence.commitHash,
    timestamp: input.evidence.timestamp,
    sourceEvidence: String(input.evidence.timestamp),
    model: mergedModel,
  };
  writeRecordJson(mergePath, summary);
}

interface SummarizeRunContext {
  evidenceDir: string;
  summariesDir: string;
  baseUrl: string;
  model: string;
  system: string;
  projectBlock: string;
  tracker: TokenUsageTracker;
}

async function summarizeSingleCommit(
  item: PendingSingle,
  commitIndex: number,
  commitTotal: number,
  ctx: SummarizeRunContext,
): Promise<void> {
  const short = item.evidence.commitHash.slice(0, 8);
  process.stdout.write(
    `[${commitIndex}/${commitTotal}] ${short} ${item.evidence.title.slice(0, 50)} ... `,
  );

  const evidenceJsonPath = path.join(
    ctx.evidenceDir,
    String(item.evidence.timestamp),
    `${item.evidence.commitHash}.json`,
  );
  const patchPath = evidenceJsonPath.replace(/\.json$/, ".patch");
  const patch = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";

  if (shouldSkipCommitSummarize(patch)) {
    const summaryPath = commitSummaryPath(
      ctx.summariesDir,
      item.evidence.timestamp,
      item.evidence.commitHash,
    );
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    writeRecordJson(summaryPath, {
      commitHash: item.evidence.commitHash,
      timestamp: item.evidence.timestamp,
      sourceEvidence: String(item.evidence.timestamp),
      model: emptyCommitModelLayer(),
    });
    console.log("skipped (empty patch)");
    return;
  }

  const prompt = buildCommitUserPrompt(item.evidence, patch);
  const raw = (await chatJson({
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    system: ctx.system,
    user: prompt,
    schema: modelJsonSchema(),
    tracker: ctx.tracker,
  })) as ModelLayer;

  const layer = enforceSignalReasons(raw);
  layer.questionsAnalysis = cleanQuestionAnalysis(layer.questionsAnalysis);
  layer.provenance = {
    model: ctx.model,
    generatedAt: new Date().toISOString(),
  };

  const summaryPath = commitSummaryPath(
    ctx.summariesDir,
    item.evidence.timestamp,
    item.evidence.commitHash,
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  writeRecordJson(summaryPath, {
    commitHash: item.evidence.commitHash,
    timestamp: item.evidence.timestamp,
    sourceEvidence: String(item.evidence.timestamp),
    model: layer,
  });
  console.log("ok");
}

async function processPendingItem(
  item: PendingItem,
  commitIndex: number,
  commitTotal: number,
  ctx: SummarizeRunContext,
): Promise<void> {
  if (item.kind === "single") {
    await summarizeSingleCommit(item, commitIndex, commitTotal, ctx);
    return;
  }

  const short = item.evidence.commitHash.slice(0, 8);
  await summarizeSplitCommit({
    commitIndex,
    commitTotal,
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    system: ctx.system,
    projectBlock: ctx.projectBlock,
    evidenceDir: ctx.evidenceDir,
    summariesDir: ctx.summariesDir,
    evidence: item.evidence,
    partCount: item.partCount,
    tracker: ctx.tracker,
    mergeFile: `${short}.merge.json`,
    canonicalFile: `${short}.json`,
  });
}

function logSummarizeFailure(item: PendingItem, err: unknown): void {
  const message = (err as Error).message;
  if (item.kind === "single") {
    console.log(`failed (${message})`);
  } else {
    console.log(`  failed (${message})`);
  }
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

  const { pending, skipped } = collectPending(allFiles, summariesDir);

  console.log(
    `${allFiles.length} total · ${skipped} already summarized (skipped) · ${pending.length} pending.`,
  );

  const work = options.limit ? pending.slice(0, options.limit) : pending;
  if (work.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`Summarizing ${work.length} commit(s)...\n`);

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("summarize");

  const ctx: SummarizeRunContext = {
    evidenceDir,
    summariesDir,
    baseUrl,
    model,
    system,
    projectBlock,
    tracker,
  };

  let done = 0;
  let failed = 0;
  try {
    for (const [i, item] of work.entries()) {
      try {
        await processPendingItem(item, i + 1, work.length, ctx);
        done += 1;
      } catch (err) {
        logSummarizeFailure(item, err);
        failed += 1;
      }
    }
  } finally {
    tracker.endStep();
  }

  console.log(`\n✅ Summarized ${done}, failed ${failed}. Summaries written to ${summariesDir}.`);
}
