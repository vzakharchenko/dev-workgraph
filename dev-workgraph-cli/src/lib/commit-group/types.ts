// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { CommitRecord } from "../records.js";

/** One Commander flag owned by a grouping strategy. */
interface CommitGroupCliOption {
  flags: string;
  description: string;
  parse?: (value: string) => unknown;
}

/** Options for {@link CommitGroupStrategy.gatherRunInputs}. */
export interface GatherRunInputsOptions {
  /** Use persisted repo settings without prompting (run gathering phase). */
  skipPromptIfSaved?: boolean;
}

/** Runner-level flags (not strategy-specific). */
interface CommitGroupStrategyOptions {
  limit?: number;
  period?: string;
  /** Parsed flags from the active strategy's {@link CommitGroupStrategy.pickCliOptions}. */
  strategyCli: Readonly<Record<string, unknown>>;
}

/** Runtime context shared between the action runner and a grouping strategy. */
export interface CommitGroupRunContext {
  repoPath: string;
  period?: string;
  groupsDir: string;
  /** Commits eligible for grouping (empty summaries already removed), oldest first. */
  commits: CommitRecord[];
  allCommitCount: number;
  emptySkipped: number;
  options: CommitGroupStrategyOptions;
}

/** Step 1 — strategy-specific setup (prompts, persisted config, params). */
export interface CommitGroupInitResult {
  label: string;
  params: Readonly<Record<string, unknown>>;
}

/** One partition bucket to summarize and write under `groups/`. */
interface CommitGroupBucket {
  members: CommitRecord[];
  /** File basename without `.json` (e.g. timestampEnd or ticket id). */
  fileKey: string;
}

/** Step 2 — partition commits into buckets (after incremental filtering). */
export interface CommitGroupPartitionResult {
  buckets: CommitGroupBucket[];
  stats: {
    rawBucketCount: number;
    pendingCount: number;
    fullyCovered: number;
  };
}

/**
 * Pluggable commit grouping: only partition logic is customizable.
 * The action runner builds {@link GroupRecord} and runs classify/compose LLM steps.
 */
export interface CommitGroupStrategy {
  readonly id: string;
  readonly displayName: string;
  readonly cliOptions: readonly CommitGroupCliOption[];
  pickCliOptions(opts: Record<string, unknown>): Record<string, unknown>;
  /**
   * Strategy-specific setup prompts and persistence.
   * Used by `run` gathering and by `init` (via the same helper).
   */
  gatherRunInputs(
    repoPath: string,
    cli?: Record<string, unknown>,
    opts?: GatherRunInputsOptions,
  ): Promise<Record<string, unknown>>;
  init(ctx: CommitGroupRunContext): Promise<CommitGroupInitResult>;
  partition(
    commits: CommitRecord[],
    init: CommitGroupInitResult,
    ctx: CommitGroupRunContext,
  ): Promise<CommitGroupPartitionResult>;
  formatSummary(
    ctx: CommitGroupRunContext,
    init: CommitGroupInitResult,
    partition: CommitGroupPartitionResult,
  ): string;
}
