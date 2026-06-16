// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { ModelLayer, Signal } from "./model.js";

/** The model's interpretation of what the project is (from README + story). */
export interface ProjectProfile {
  summary: string;
  domains: string[];
  apparentStack: string[];
  keyThemes: string[];
}

/**
 * The model layer of a prepared narrative: a single distilled history, signals
 * copied from the report, four collapsed reasons, and four role-aware questions.
 */
export interface PreparedModelLayer {
  changeTypes: string[];
  /** Cleaned, deduped, class-collapsed technology list (e.g. JS subsumed by TS). */
  technologies: string[];
  technicalSignal: Signal;
  architectureSignal: Signal;
  securitySignal: Signal;
  signalReasons: string[];
  questions: string[];
  confidence: Signal;
  history: string;
  provenance: {
    model: string;
    generatedAt: string;
    sourceReport: string;
  };
}

/**
 * A prepared narrative on disk (written by `prepare`): the human-facing
 * distillation of the latest report.
 */
export interface PreparedRecord {
  preparedId: number;
  sourceReport: string;
  groupCount: number;
  model: PreparedModelLayer;
  /** Human answers to `model.questions`, collected by `final`. */
  answers?: { question: string; answer: string }[];
  answeredAt?: string;
}

/**
 * Project context captured by `init`, grounding every later LLM call.
 * Stored at `~/.workgraph/data/repos/<repo-id>/project.json`.
 */
export interface ProjectContext {
  role: string;
  story: {
    raw: string;
    preparedContext: string;
  };
  readme: {
    present: boolean;
    path?: string;
  };
  profile: ProjectProfile;
  provenance: {
    model: string;
    generatedAt: string;
  };
}

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
 * The model layer for a group. Like the per-commit model layer but its prose
 * field is a `history` (a fuller account, not a terse summary) instead of
 * `summary`, plus three tiers of **context bullets** (not commit hashes):
 * `hiContext` captures the substantial work, `lowContext` the routine background.
 */
export interface GroupModelLayer extends Omit<ModelLayer, "summary"> {
  history: string;
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

/**
 * One running history entry inside a cumulative report, with provenance: the
 * group files that created or rewrote it. This is a fuller account of what was
 * done, not a terse summary.
 */
export interface ReportHistoryEntry {
  text: string;
  /** Group file names that contributed to this entry, e.g. ["1579390000.json"]. */
  sourceGroups: string[];
}

/**
 * The model layer of a cumulative report. Signals stay single (the max across
 * folded groups) but `signalReasons` are arrays of merged reasons.
 */
export interface ReportModelLayer {
  changeTypes: string[];
  /** Union of the folded groups' technologies (deduped; cleaned only at `prepare`). */
  technologies: string[];
  technicalSignal: Signal;
  architectureSignal: Signal;
  securitySignal: Signal;
  signalReasons: {
    technical: string[];
    architecture: string[];
    security: string[];
  };
  questions: string[];
  confidence: Signal;
  hiContext: string[];
  mediumContext: string[];
  lowContext: string[];
  provenance?: {
    model: string;
    generatedAt: string;
  };
}

/**
 * A cumulative report on disk (written by `report`): the fold of work-session
 * groups up to and including the latest one. Links source groups by file name,
 * not commit hashes.
 */
export interface ReportRecord {
  reportId: number;
  sourceGroups: string[];
  groupCount: number;
  deterministic: DeterministicLayer;
  model: ReportModelLayer;
  /** Running history of distinct work (with provenance), rewritten as the report grows. */
  history: ReportHistoryEntry[];
  /**
   * Rolling compaction cursor: 0-based index of the first entry in the next pair
   * to merge when `history` overflows `MAX_HISTORY_ENTRIES`. Advances down the
   * list each time it fires and wraps to 0, so compression is spread evenly
   * across all ages instead of always re-squashing the oldest blob. Absent on
   * legacy records ⇒ treated as 0.
   */
  mergeCursor?: number;
}