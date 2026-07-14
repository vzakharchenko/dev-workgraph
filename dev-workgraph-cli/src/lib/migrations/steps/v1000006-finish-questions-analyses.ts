// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { finishJsonFileName, finishQuestionsJsonFileName } from "../../finish-load.js";
import { createFinishQuestions, questionAnalysesForRecord } from "../../finish-questions.js";
import { flattenQuestions } from "../../model.js";
import { finishQuestionProvenance } from "../../question-provenance.js";
import type { FinishQuestionsRecord, PreparedRecord } from "../../records.js";
import {
  backupArtifactFile,
  readRecordJson,
  readSchemaVersion,
  writeMigratedRecord,
} from "../io.js";
import type { MigrationArtifactKind, MigrationContext, MigrationStepKind } from "../types.js";

export const FINISH_QUESTIONS_ANALYSES_VERSION = 1_000_006;

function movePreparedAnalysesToFinishQuestions(
  prepared: PreparedRecord,
  ctx: MigrationContext,
): void {
  const analyses = prepared.model.questionsAnalyses;
  if (!analyses?.length) return;

  const questionsPath = path.join(
    ctx.finishDir,
    finishQuestionsJsonFileName(prepared.preparedId, 1),
  );
  fs.mkdirSync(ctx.finishDir, { recursive: true });

  if (fs.existsSync(questionsPath)) {
    const existing = readRecordJson(questionsPath) as unknown as FinishQuestionsRecord;
    if (!existing.questionsAnalyses?.length) {
      const questions = existing.questions.map((q, i) => ({
        ...q,
        ...finishQuestionProvenance(analyses[i], q.threadIndex ?? i),
      }));
      const next = {
        ...existing,
        questions,
        questionsAnalyses: analyses,
      };
      writeMigratedRecord(questionsPath, next, ctx.dryRun);
    }
    return;
  }

  const texts = flattenQuestions(analyses);
  const record = createFinishQuestions(
    texts,
    {
      sourceFinal: finishJsonFileName(prepared.preparedId, 1),
      sourceReport: prepared.sourceReport,
    },
    Date.now(),
    analyses,
  );
  writeMigratedRecord(questionsPath, record as unknown as Record<string, unknown>, ctx.dryRun);
}

function stripPreparedAnalyses(prepared: PreparedRecord): PreparedRecord {
  const { questionsAnalyses: _removed, ...model } = prepared.model;
  return { ...prepared, model };
}

function migratePreparedRecord(record: PreparedRecord, ctx: MigrationContext): PreparedRecord {
  movePreparedAnalysesToFinishQuestions(record, ctx);
  return stripPreparedAnalyses(record);
}

function migrateFinishQuestionsRecord(record: FinishQuestionsRecord): FinishQuestionsRecord {
  if (record.questionsAnalyses?.length) return record;
  const analyses = questionAnalysesForRecord(record);
  if (analyses.length === 0) return record;
  return { ...record, questionsAnalyses: analyses };
}

function migrateRecord(
  record: Record<string, unknown>,
  kind: MigrationArtifactKind,
  ctx: MigrationContext,
): Record<string, unknown> {
  switch (kind) {
    case "prepared":
      return migratePreparedRecord(record as unknown as PreparedRecord, ctx) as unknown as Record<
        string,
        unknown
      >;
    case "finish-questions":
      return migrateFinishQuestionsRecord(
        record as unknown as FinishQuestionsRecord,
      ) as unknown as Record<string, unknown>;
    default:
      return record;
  }
}

/** Schema 1.0.6 — question cards live on finish `*.question.json`, not prepared. */
export const finishQuestionsAnalysesStep: MigrationStepKind = {
  toVersion: FINISH_QUESTIONS_ANALYSES_VERSION,
  label: "finish-questions-analyses",
  artifactKinds: ["prepared", "finish-questions"],

  migrate(filePath, kind, ctx) {
    const fromVersion = readSchemaVersion(filePath);
    const record = readRecordJson(filePath);
    const migrated = migrateRecord(record, kind, ctx) as Record<string, unknown>;

    if (fromVersion >= this.toVersion) {
      if (JSON.stringify(migrated) !== JSON.stringify(record)) {
        migrated.schemaVersion = this.toVersion;
        writeMigratedRecord(filePath, migrated, ctx.dryRun);
      }
      return this.toVersion;
    }

    if (ctx.backup && !ctx.dryRun) backupArtifactFile(filePath, fromVersion);

    migrated.schemaVersion = this.toVersion;
    writeMigratedRecord(filePath, migrated, ctx.dryRun);
    return this.toVersion;
  },
};
