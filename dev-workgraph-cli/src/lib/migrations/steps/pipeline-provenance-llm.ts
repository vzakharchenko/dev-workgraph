// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type { QuestionAnalyses } from "../../model.js";
import { migrateLineageJsonSchema } from "../../model.js";
import { chatJson } from "../../ollama.js";
import { loadProjectContext } from "../../project.js";
import {
  buildMigrateLineagePrompt,
  MIGRATE_LINEAGE_SYSTEM,
  projectContextBlock,
  withProjectContext,
} from "../../prompts.js";
import { enrichQuestionCards, polishEvidenceExcerptsWithLlm } from "../../question-cards.js";
import {
  finishQuestionProvenance,
  resolvePrepareQuestionProvenanceFromLlm,
} from "../../question-provenance.js";
import type { FinishQuestionsRecord, PreparedRecord, ReportRecord } from "../../records.js";
import {
  reportModelToSignalReasonArrays,
  signalReasonArrayTexts,
} from "../../signal-reason-provenance.js";
import { TokenUsageTracker } from "../../token-usage.js";
import {
  listFinishQuestionFiles,
  listJsonFiles,
  readRecordJson,
  writeMigratedRecord,
} from "../io.js";
import {
  logLlmBackfillFile,
  logLlmBackfillSkip,
  logLlmSubstep,
  logLlmSubstepDone,
  relArtifactPath,
} from "../migration-log.js";
import type { MigrationArtifactKind, MigrationContext } from "../types.js";

function threadHasQuestionText(thread: QuestionAnalyses): boolean {
  return [...thread.observation, ...thread.missingPiece, ...thread.question].some(
    (line) => line.trim().length > 0,
  );
}

function threadHasDerivedRefs(thread: QuestionAnalyses): boolean {
  return (
    (thread.derivedFromThreadIds?.length ?? 0) > 0 ||
    (thread.derivedFromReportSignalRefs?.length ?? 0) > 0 ||
    (thread.derivedFromPreparedSignalSlots?.length ?? 0) > 0
  );
}

/** Legacy prepared/finish threads with question text but no prepare-level lineage refs. */
export function needsPipelineProvenanceLlmBackfill(threads: QuestionAnalyses[]): boolean {
  return threads.some((thread) => threadHasQuestionText(thread) && !threadHasDerivedRefs(thread));
}

function loadReport(reportPath: string): ReportRecord | null {
  if (!fs.existsSync(reportPath)) return null;
  return readRecordJson(reportPath) as unknown as ReportRecord;
}

function mergeLineageOntoThreads(
  threads: QuestionAnalyses[],
  lineageRows: unknown,
): QuestionAnalyses[] {
  const rows = Array.isArray(lineageRows) ? lineageRows : [];
  return threads.map((thread, index) => {
    const row = rows[index];
    if (!row || typeof row !== "object") return thread;
    const entry = row as Partial<QuestionAnalyses>;
    const merged: QuestionAnalyses = { ...thread };
    if (entry.derivedFromThreadIds?.length) {
      merged.derivedFromThreadIds = entry.derivedFromThreadIds;
    }
    if (entry.derivedFromReportSignalRefs?.length) {
      merged.derivedFromReportSignalRefs = entry.derivedFromReportSignalRefs;
    }
    if (entry.derivedFromPreparedSignalSlots?.length) {
      merged.derivedFromPreparedSignalSlots = entry.derivedFromPreparedSignalSlots;
    }
    return merged;
  });
}

async function backfillThreadsWithLlm(
  threads: QuestionAnalyses[],
  prepared: PreparedRecord,
  report: ReportRecord,
  ctx: MigrationContext,
  tracker: TokenUsageTracker,
): Promise<QuestionAnalyses[]> {
  const llm = ctx.llmSlots?.narrative;
  if (!llm || !needsPipelineProvenanceLlmBackfill(threads)) return threads;

  const projectBlock = projectContextBlock(loadProjectContext(ctx.repoPath, ctx.period));
  const reportSignalReasons = reportModelToSignalReasonArrays(report.model.signalReasons);
  const preparedSlots = signalReasonArrayTexts(prepared.model.signalReasons);

  logLlmSubstep("[1/3] attach lineage refs (LLM) … ");
  const raw = (await chatJson({
    provider: llm.providerId,
    baseUrl: llm.baseUrl,
    model: llm.model,
    system: withProjectContext(projectBlock, MIGRATE_LINEAGE_SYSTEM),
    user: buildMigrateLineagePrompt(
      prepared.model.history,
      preparedSlots,
      threads,
      report.model.questionsAnalyses ?? [],
      report.model.signalReasons,
    ),
    schema: migrateLineageJsonSchema(),
    think: false,
    tracker,
  })) as { lineage?: unknown };
  logLlmSubstepDone("ok");

  logLlmSubstep("[2/3] resolve provenance (code) … ");
  const withRefs = mergeLineageOntoThreads(threads, raw.lineage);
  let resolved = resolvePrepareQuestionProvenanceFromLlm(
    withRefs,
    report.model.questionsAnalyses ?? [],
    reportSignalReasons,
  );
  resolved = enrichQuestionCards(resolved);
  logLlmSubstepDone(`ok (${resolved.length} thread(s))`);

  logLlmSubstep("[3/3] polish evidence excerpts … ");
  try {
    resolved = await polishEvidenceExcerptsWithLlm({
      threads: resolved,
      provider: llm.providerId,
      baseUrl: llm.baseUrl,
      model: llm.model,
      projectBlock,
      tracker,
    });
    logLlmSubstepDone("ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "llm failed";
    logLlmSubstepDone(`skipped (${msg})`);
  }

  return resolved;
}

/** LLM backfill for one prepared or finish-questions artifact (pipeline provenance step). */
export async function backfillPipelineProvenanceArtifact(
  filePath: string,
  kind: Extract<MigrationArtifactKind, "prepared" | "finish-questions">,
  ctx: MigrationContext,
  tracker: TokenUsageTracker,
): Promise<boolean> {
  if (!ctx.llmSlots?.narrative || ctx.dryRun) return false;

  const rel = relArtifactPath(filePath, ctx.dataRoot);
  logLlmBackfillFile(rel);

  if (kind === "prepared") {
    const prepared = readRecordJson(filePath) as unknown as PreparedRecord;
    const threads = prepared.model.questionsAnalyses ?? [];
    if (threads.length === 0) {
      logLlmBackfillSkip("no questionsAnalyses on prepared");
      return false;
    }
    if (!needsPipelineProvenanceLlmBackfill(threads)) {
      logLlmBackfillSkip("lineage refs already present");
      return false;
    }

    const report = loadReport(path.join(ctx.reportsDir, prepared.sourceReport));
    if (!report) {
      logLlmBackfillSkip(`report not found: ${prepared.sourceReport}`);
      return false;
    }

    const repairedThreads = await backfillThreadsWithLlm(threads, prepared, report, ctx, tracker);
    if (JSON.stringify(repairedThreads) === JSON.stringify(threads)) {
      logLlmBackfillSkip("LLM returned no new lineage");
      return false;
    }

    const next: PreparedRecord = {
      ...prepared,
      model: { ...prepared.model, questionsAnalyses: repairedThreads },
    };
    writeMigratedRecord(filePath, next as unknown as Record<string, unknown>, ctx.dryRun);
    console.log(`  wrote ${rel}`);
    return true;
  }

  const record = readRecordJson(filePath) as unknown as FinishQuestionsRecord;
  const threads = record.questionsAnalyses ?? [];
  if (threads.length === 0) {
    logLlmBackfillSkip("no questionsAnalyses on finish question file");
    return false;
  }
  if (!needsPipelineProvenanceLlmBackfill(threads)) {
    logLlmBackfillSkip("lineage refs already present");
    return false;
  }

  const preparedPath = path.join(
    ctx.preparedDir,
    preparedFileNameFromFinishSource(record.sourceFinal),
  );
  if (!fs.existsSync(preparedPath)) {
    logLlmBackfillSkip(`prepared not found: ${path.basename(preparedPath)}`);
    return false;
  }
  const prepared = readRecordJson(preparedPath) as unknown as PreparedRecord;

  const report = loadReport(path.join(ctx.reportsDir, record.sourceReport));
  if (!report) {
    logLlmBackfillSkip(`report not found: ${record.sourceReport}`);
    return false;
  }

  const repairedThreads = await backfillThreadsWithLlm(threads, prepared, report, ctx, tracker);
  if (JSON.stringify(repairedThreads) === JSON.stringify(threads)) {
    logLlmBackfillSkip("LLM returned no new lineage");
    return false;
  }

  const questions = record.questions.map((q, i) => ({
    ...q,
    ...finishQuestionProvenance(repairedThreads[i], q.threadIndex ?? i),
  }));
  const next: FinishQuestionsRecord = {
    ...record,
    questionsAnalyses: repairedThreads,
    questions,
  };
  writeMigratedRecord(filePath, next as unknown as Record<string, unknown>, ctx.dryRun);
  console.log(`  wrote ${rel}`);
  return true;
}

function preparedFileNameFromFinishSource(sourceFinal: string): string {
  const base = path.basename(sourceFinal);
  const match = /^(\d+)(?:\.v\d+)?\.json$/i.exec(base);
  return match ? `${match[1]}.json` : base;
}

/** Phase 2 of pipelineProvenanceStep: LLM lineage backfill on prepared + finish-questions. */
export async function runPipelineProvenanceLlmBackfill(ctx: MigrationContext): Promise<number> {
  if (!ctx.llmSlots?.narrative || ctx.dryRun) return 0;

  const tracker = new TokenUsageTracker(ctx.repoPath, ctx.period);
  tracker.beginStep("migrate");

  let changed = 0;
  try {
    for (const file of listJsonFiles(ctx.preparedDir)) {
      if (await backfillPipelineProvenanceArtifact(file, "prepared", ctx, tracker)) changed += 1;
    }
    for (const file of listFinishQuestionFiles(ctx.finishDir)) {
      if (await backfillPipelineProvenanceArtifact(file, "finish-questions", ctx, tracker)) {
        changed += 1;
      }
    }
  } finally {
    tracker.endStep();
  }

  return changed;
}
