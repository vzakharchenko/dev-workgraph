// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import {
  repoDataRoot,
  repoFinishDir,
  repoGroupsDir,
  repoPreparedDir,
  repoReportsDir,
  repoSummariesDir,
} from "../config.js";
import { repairQuestionLineageArtifact } from "../repair-question-lineage.js";
import { VERSION } from "../version.js";
import { completeMigrationContext, detectArtifactKind } from "./detect.js";
import {
  listFinishArchiveFiles,
  listFinishQuestionFiles,
  listJsonFiles,
  readSchemaVersion,
  stampSchemaVersionOnly,
} from "./io.js";
import {
  logLlmBackfillHeader,
  logMigrationPhase,
  logStructuralFileChanged,
  logStructuralKindHeader,
  logStructuralKindSummary,
} from "./migration-log.js";
import { MIGRATION_STEP_KINDS } from "./providers.js";
import { runPipelineProvenanceLlmBackfill } from "./steps/pipeline-provenance-llm.js";
import { PIPELINE_PROVENANCE_VERSION } from "./steps/v1000005-pipeline-provenance.js";
import type { MigrationArtifactKind, MigrationContext, MigrationRepoReport } from "./types.js";

function maxMigrationVersionForKind(kind: MigrationArtifactKind): number {
  let max = 0;
  for (const step of MIGRATION_STEP_KINDS) {
    if (step.artifactKinds.includes(kind)) max = Math.max(max, step.toVersion);
  }
  return max;
}

export function buildMigrationContext(
  repoPath: string,
  options: { period?: string; dryRun?: boolean; backup?: boolean } = {},
): MigrationContext {
  const dataRoot = repoDataRoot(repoPath, options.period);
  return {
    repoPath,
    period: options.period,
    dataRoot,
    groupsDir: repoGroupsDir(repoPath, options.period),
    reportsDir: repoReportsDir(repoPath, options.period),
    preparedDir: repoPreparedDir(repoPath, options.period),
    finishDir: repoFinishDir(repoPath, options.period),
    summariesDir: repoSummariesDir(repoPath, options.period),
    dryRun: options.dryRun ?? false,
    backup: options.backup ?? false,
  };
}

interface MigrateFileDetails {
  toVersion: number;
  fromVersion: number;
  appliedStepLabels: string[];
}

function migrateFileDetailed(filePath: string, ctx: MigrationContext): MigrateFileDetails {
  const kind = detectArtifactKind(filePath, ctx);
  if (!kind) throw new Error(`Not a migratable artifact: ${filePath}`);

  const fromVersion = readSchemaVersion(filePath);
  let version = fromVersion;
  const appliedStepLabels: string[] = [];

  for (const step of MIGRATION_STEP_KINDS) {
    if (version >= step.toVersion) continue;
    if (!step.artifactKinds.includes(kind)) continue;
    version = step.migrate(filePath, kind, ctx);
    if (version !== step.toVersion) {
      throw new Error(`Migration ${step.label} returned ${version}, expected ${step.toVersion}`);
    }
    appliedStepLabels.push(step.label);
  }

  if (version < VERSION && version >= maxMigrationVersionForKind(kind)) {
    version = stampSchemaVersionOnly(filePath, ctx.dryRun);
    if (version !== fromVersion) appliedStepLabels.push("schema-version-stamp");
  }

  if (kind === "prepared" || kind === "finish-questions") {
    repairQuestionLineageArtifact(filePath, kind, ctx);
  }

  return { toVersion: version, fromVersion, appliedStepLabels };
}

/**
 * Migrates one artifact file through all pending steps for its kind.
 * @returns schemaVersion after migration.
 */
export function migrateFile(filePath: string, ctx: MigrationContext): number {
  return migrateFileDetailed(filePath, ctx).toVersion;
}

function migrateOne(filePath: string, ctx: MigrationContext, report: MigrationRepoReport): boolean {
  const kind = detectArtifactKind(filePath, ctx);
  if (!kind) return false;
  try {
    const details = migrateFileDetailed(filePath, ctx);
    const changed = details.toVersion !== details.fromVersion;
    report.files.push({
      file: filePath,
      kind,
      fromVersion: details.fromVersion,
      toVersion: details.toVersion,
      changed,
    });
    if (changed) {
      logStructuralFileChanged(
        filePath,
        ctx.dataRoot,
        details.fromVersion,
        details.toVersion,
        details.appliedStepLabels,
      );
    }
    return changed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.errors.push({ file: filePath, message });
    return false;
  }
}

function migrateKindBatch(
  kind: MigrationArtifactKind,
  files: string[],
  ctx: MigrationContext,
  report: MigrationRepoReport,
): void {
  logStructuralKindHeader(kind, files.length);
  let changed = 0;
  for (const file of files) {
    if (migrateOne(file, ctx, report)) changed += 1;
  }
  logStructuralKindSummary(changed, files.length);
}

/** Migrates all pipeline artifacts for a repo in dependency order. */
export async function migrateRepo(ctx: MigrationContext): Promise<MigrationRepoReport> {
  const report: MigrationRepoReport = { files: [], errors: [] };

  logMigrationPhase("Phase 1/2: structural schema migration");
  console.log("  order: groups → reports → prepared → finish-questions → finish archives\n");

  migrateKindBatch("group", listJsonFiles(ctx.groupsDir), ctx, report);
  migrateKindBatch("report", listJsonFiles(ctx.reportsDir), ctx, report);
  migrateKindBatch("prepared", listJsonFiles(ctx.preparedDir), ctx, report);
  migrateKindBatch("finish-questions", listFinishQuestionFiles(ctx.finishDir), ctx, report);
  migrateKindBatch("finish", listFinishArchiveFiles(ctx.finishDir), ctx, report);

  if (ctx.llmSlots && !ctx.dryRun) {
    logMigrationPhase("Phase 2/2: LLM lineage backfill");
    const { narrative } = ctx.llmSlots;
    logLlmBackfillHeader(narrative.model, narrative.baseUrl);
    console.log("");
    try {
      const llmChanged = await runPipelineProvenanceLlmBackfill(ctx);
      if (llmChanged === 0) {
        console.log("  (no prepared/finish files needed LLM backfill)");
      } else {
        console.log(`\n  ${llmChanged} file(s) updated with LLM lineage`);
      }
      if (llmChanged > 0) {
        report.files.push({
          file: "(pipeline-provenance-llm)",
          kind: "prepared",
          fromVersion: PIPELINE_PROVENANCE_VERSION,
          toVersion: PIPELINE_PROVENANCE_VERSION,
          changed: true,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push({ file: "(pipeline-provenance-llm)", message });
    }
  }

  return report;
}

/** Ensures an artifact is migrated before read (lazy on load). */
export function ensureArtifactMigrated(
  filePath: string,
  hints: Partial<MigrationContext> = {},
): number {
  const migrationCtx = completeMigrationContext(filePath, hints);
  if (!migrationCtx) return readSchemaVersion(filePath);
  const kind = detectArtifactKind(filePath, migrationCtx);
  if (!kind) return readSchemaVersion(filePath);
  return migrateFile(filePath, migrationCtx);
}
