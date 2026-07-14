// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { PipelineLlmSlots } from "../resolve-pipeline-llm-slots.js";

/** Pipeline artifact kinds a migration step may touch. */
export type MigrationArtifactKind = "group" | "report" | "prepared" | "finish-questions" | "finish";

export interface MigrationContext {
  /** Absolute repository path (for logging). */
  repoPath: string;
  period?: string;
  /** Repo data root (`~/.workgraph/data/repos/<id>` or `.../periods/<p>`). */
  dataRoot: string;
  groupsDir: string;
  reportsDir: string;
  preparedDir: string;
  finishDir: string;
  summariesDir: string;
  dryRun: boolean;
  backup: boolean;
  /** Pipeline LLM slots (same as `run`); narrative used for prepare/finish lineage backfill. */
  llmSlots?: PipelineLlmSlots;
}

interface MigrationFileResult {
  file: string;
  kind: MigrationArtifactKind;
  fromVersion: number;
  toVersion: number;
  changed: boolean;
}

export interface MigrationRepoReport {
  files: MigrationFileResult[];
  errors: { file: string; message: string }[];
}

/**
 * Static migration plugin — one schema bump.
 * Register in {@link MIGRATION_STEP_KINDS} (sorted by {@link toVersion}).
 */
export interface MigrationStepKind {
  /** Target schemaVersion after this step (encoded semver, e.g. 1.0.5 → 1000005). */
  readonly toVersion: number;
  readonly label: string;
  /** Which artifact kinds this step implements. */
  readonly artifactKinds: readonly MigrationArtifactKind[];
  /**
   * Migrate one file on disk: read → transform → write (unless dryRun).
   * @returns schemaVersion after this step.
   */
  migrate(filePath: string, kind: MigrationArtifactKind, ctx: MigrationContext): number;
}
