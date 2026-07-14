// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import {
  legacyPreparedQuestionAnalyses,
  withLegacyPreparedQuestionAnalyses,
} from "./legacy-prepared.js";
import { readRecordJson, writeMigratedRecord } from "./migrations/io.js";
import { FINISH_QUESTIONS_ANALYSES_VERSION } from "./migrations/steps/v1000006-finish-questions-analyses.js";
import type { MigrationArtifactKind, MigrationContext } from "./migrations/types.js";
import type { QuestionAnalyses } from "./model.js";
import {
  finishQuestionProvenance,
  needsQuestionLineageRepair,
  repairPreparedQuestionLineage,
} from "./question-provenance.js";
import type {
  FinishQuestion,
  FinishQuestionsRecord,
  PreparedRecord,
  ReportRecord,
} from "./records.js";
import {
  normalizePreparedSignalReasons,
  reportModelToSignalReasonArrays,
} from "./signal-reason-provenance.js";

function preparedFileNameFromFinishSource(sourceFinal: string): string {
  const base = path.basename(sourceFinal);
  const match = /^(\d+)(?:\.v\d+)?\.json$/i.exec(base);
  return match ? `${match[1]}.json` : base;
}

function loadReportForPrepared(
  prepared: PreparedRecord,
  ctx: MigrationContext,
): ReportRecord | null {
  const reportPath = path.join(ctx.reportsDir, prepared.sourceReport);
  if (!fs.existsSync(reportPath)) return null;
  return readRecordJson(reportPath) as unknown as ReportRecord;
}

function loadReportForFinishQuestions(
  record: FinishQuestionsRecord,
  ctx: MigrationContext,
): ReportRecord | null {
  const reportPath = path.join(ctx.reportsDir, record.sourceReport);
  if (!fs.existsSync(reportPath)) return null;
  return readRecordJson(reportPath) as unknown as ReportRecord;
}

/** Repairs empty question lineage on a finish question file in memory. */
export function repairFinishQuestionsRecordLineage(
  record: FinishQuestionsRecord,
  ctx: MigrationContext,
): FinishQuestionsRecord {
  const threads = record.questionsAnalyses ?? [];
  if (!needsQuestionLineageRepair(threads)) return record;

  const report = loadReportForFinishQuestions(record, ctx);
  const reportSignalReasons = report
    ? reportModelToSignalReasonArrays(report.model.signalReasons)
    : { technical: [], architecture: [], security: [] };
  const repairedThreads = repairPreparedQuestionLineage(
    threads,
    report?.model.questionsAnalyses ?? [],
    reportSignalReasons,
  );
  const questions = record.questions.map((q, i) => ({
    ...q,
    ...finishQuestionProvenance(repairedThreads[i], q.threadIndex ?? i),
  }));

  return { ...record, questionsAnalyses: repairedThreads, questions };
}

/** Repairs empty question lineage on a prepared record (legacy analyses only). */
export function repairPreparedRecordQuestionLineage(
  prepared: PreparedRecord,
  ctx: MigrationContext,
): PreparedRecord {
  const threads = legacyPreparedQuestionAnalyses(prepared);
  if (!needsQuestionLineageRepair(threads)) return prepared;

  const report = loadReportForPrepared(prepared, ctx);
  const reportSignalReasons = report
    ? reportModelToSignalReasonArrays(report.model.signalReasons)
    : { technical: [], architecture: [], security: [] };
  const repairedThreads = repairPreparedQuestionLineage(
    threads,
    report?.model.questionsAnalyses ?? [],
    reportSignalReasons,
  );

  const repaired = withLegacyPreparedQuestionAnalyses(prepared, repairedThreads);
  const model = {
    ...(repaired.model as unknown as Record<string, unknown>),
    signalReasons: normalizePreparedSignalReasons(
      prepared.model.signalReasons,
    ) as PreparedRecord["model"]["signalReasons"],
  };
  return { ...repaired, model: model as unknown as PreparedRecord["model"] };
}

/** Repairs finish question file on disk when lineage is empty; returns true if written. */
function repairFinishQuestionsArtifact(filePath: string, ctx: MigrationContext): boolean {
  const record = readRecordJson(filePath) as unknown as FinishQuestionsRecord;
  const threads = record.questionsAnalyses ?? [];
  if (!needsQuestionLineageRepair(threads)) return false;
  const repaired = repairFinishQuestionsRecordLineage(record, ctx);
  if (JSON.stringify(repaired) === JSON.stringify(record)) return false;
  writeMigratedRecord(filePath, repaired, ctx.dryRun);
  return !ctx.dryRun;
}

/** Repairs prepared on disk when legacy question lineage is empty; returns true if written. */
function repairPreparedArtifact(filePath: string, ctx: MigrationContext): boolean {
  const prepared = readRecordJson(filePath) as unknown as PreparedRecord;
  if ((prepared.schemaVersion ?? 0) >= FINISH_QUESTIONS_ANALYSES_VERSION) return false;
  const legacyThreads = legacyPreparedQuestionAnalyses(prepared);
  if (legacyThreads.length === 0) return false;
  if (!needsQuestionLineageRepair(legacyThreads)) return false;
  const repaired = repairPreparedRecordQuestionLineage(prepared, ctx);
  if (JSON.stringify(repaired) === JSON.stringify(prepared)) return false;
  writeMigratedRecord(filePath, repaired, ctx.dryRun);
  return !ctx.dryRun;
}

/** Repairs finish questions from prepared lineage; returns true if written. */
function repairFinishQuestionsFromPreparedArtifact(
  filePath: string,
  ctx: MigrationContext,
): boolean {
  const record = readRecordJson(filePath) as unknown as FinishQuestionsRecord;
  if ((record.questionsAnalyses?.length ?? 0) > 0) {
    return repairFinishQuestionsArtifact(filePath, ctx);
  }

  const preparedPath = path.join(
    ctx.preparedDir,
    preparedFileNameFromFinishSource(record.sourceFinal),
  );
  if (!fs.existsSync(preparedPath)) return repairFinishQuestionsArtifact(filePath, ctx);

  repairPreparedArtifact(preparedPath, ctx);
  const prepared = readRecordJson(preparedPath) as unknown as PreparedRecord;
  const threads = legacyPreparedQuestionAnalyses(prepared);
  if (threads.length === 0) return repairFinishQuestionsArtifact(filePath, ctx);

  const questions = record.questions.map((q, i) => mergeFinishQuestionFromThread(q, i, threads));

  const next: FinishQuestionsRecord = {
    ...record,
    questions,
    questionsAnalyses: threads,
  };
  if (JSON.stringify(next) === JSON.stringify(record)) return false;
  writeMigratedRecord(filePath, next, ctx.dryRun);
  return !ctx.dryRun;
}

function mergeFinishQuestionFromThread(
  q: FinishQuestion,
  index: number,
  threads: QuestionAnalyses[],
): FinishQuestion {
  const threadIndex = q.threadIndex ?? index;
  const thread = threads[threadIndex];
  if (!thread) return q;
  return { ...q, ...finishQuestionProvenance(thread, threadIndex) };
}

/** Repairs prepared or finish-questions artifacts with empty question lineage. */
export function repairQuestionLineageArtifact(
  filePath: string,
  kind: MigrationArtifactKind,
  ctx: MigrationContext,
): boolean {
  if (kind === "prepared") return repairPreparedArtifact(filePath, ctx);
  if (kind === "finish-questions") return repairFinishQuestionsFromPreparedArtifact(filePath, ctx);
  return false;
}
