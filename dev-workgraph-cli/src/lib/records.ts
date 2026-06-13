// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { ModelLayer } from "./model.js";

/**
 * The deterministic, model-free evidence layer shared by commit and group
 * records.
 */
export interface DeterministicLayer {
  changedFiles: {
    added: string[];
    deleted: string[];
    modified: string[];
    renamed: string[];
  };
  linesAdded: number;
  linesDeleted: number;
  importantFolders: string[];
  areas: string[];
  excludedFiles: string[];
}

/**
 * One exported commit on disk (written by `export`, model filled by
 * `summarize`).
 */
export interface CommitRecord {
  commitHash: string;
  timestamp: number;
  title: string;
  author: string;
  deterministic: DeterministicLayer;
  model: ModelLayer | null;
}

/** Signal tiers a commit can fall into within a group. */
export type Tier = "low" | "medium" | "hi";

/**
 * Deterministic partition of member commit hashes by signal tier. Keeps the
 * "which commit is high/medium/low" link as evidence, separate from the
 * model's narrative context (see {@link GroupModelLayer}).
 */
export interface GroupTiers {
  low: string[];
  medium: string[];
  hi: string[];
}

/**
 * The `groups` block: all member hashes plus their deterministic tier partition.
 */
export interface GroupsBlock {
  commits: string[];
  tiers: GroupTiers;
}

/**
 * The model layer for a group. Extends the per-commit model layer with three
 * tiers of **context bullets** (not commit hashes): `hiContext` captures the
 * substantial work, `lowContext` the routine background.
 */
export interface GroupModelLayer extends ModelLayer {
  hiContext: string[];
  mediumContext: string[];
  lowContext: string[];
}

/**
 * One work-session group on disk (written by `commit-group`).
 */
export interface GroupRecord {
  groupId: number;
  timestampStart: number;
  timestampEnd: number;
  commitCount: number;
  groups: GroupsBlock;
  deterministic: DeterministicLayer;
  model: GroupModelLayer | null;
}