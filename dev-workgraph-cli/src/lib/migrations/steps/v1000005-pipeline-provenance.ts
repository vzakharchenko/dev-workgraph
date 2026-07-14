// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type {
  FinishQuestionsRecord,
  FinishRecord,
  GroupRecord,
  PreparedRecord,
  ReportRecord,
} from "../../records.js";
import {
  backupArtifactFile,
  readRecordJson,
  readSchemaVersion,
  writeMigratedRecord,
} from "../io.js";
import type { MigrationArtifactKind, MigrationContext, MigrationStepKind } from "../types.js";
import {
  migrateFinishQuestionsRecord,
  migrateFinishRecord,
  migrateGroupRecord,
  migratePreparedRecord,
  migrateReportRecord,
} from "./pipeline-provenance-migrate.js";

export const PIPELINE_PROVENANCE_VERSION = 1_000_005;

function migrateRecord(
  record: Record<string, unknown>,
  kind: MigrationArtifactKind,
  ctx: MigrationContext,
): Record<string, unknown> {
  switch (kind) {
    case "group":
      return migrateGroupRecord(record as unknown as GroupRecord, ctx) as unknown as Record<
        string,
        unknown
      >;
    case "report":
      return migrateReportRecord(record as unknown as ReportRecord, ctx) as unknown as Record<
        string,
        unknown
      >;
    case "prepared":
      return migratePreparedRecord(record as unknown as PreparedRecord, ctx) as unknown as Record<
        string,
        unknown
      >;
    case "finish-questions":
      return migrateFinishQuestionsRecord(
        record as unknown as FinishQuestionsRecord,
        ctx,
      ) as unknown as Record<string, unknown>;
    case "finish":
      return migrateFinishRecord(record as unknown as FinishRecord) as unknown as Record<
        string,
        unknown
      >;
  }
}

/** Schema 1.0.5 — signal reason + question provenance; LLM backfill via {@link runPipelineProvenanceLlmBackfill}. */
export const pipelineProvenanceStep: MigrationStepKind = {
  toVersion: PIPELINE_PROVENANCE_VERSION,
  label: "pipeline-provenance",
  artifactKinds: ["group", "report", "prepared", "finish-questions", "finish"],

  migrate(filePath, kind, ctx) {
    const fromVersion = readSchemaVersion(filePath);
    if (fromVersion >= this.toVersion) return fromVersion;

    if (ctx.backup && !ctx.dryRun) backupArtifactFile(filePath, fromVersion);

    const record = readRecordJson(filePath);
    const next = migrateRecord(record, kind, ctx);
    next.schemaVersion = this.toVersion;
    writeMigratedRecord(filePath, next, ctx.dryRun);
    return this.toVersion;
  },
};
