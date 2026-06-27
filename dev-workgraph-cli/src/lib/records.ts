// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { ModelLayer, QuestionAnalyses, Signal } from "./model.js";

/** One question stored in a finish question file; `id` is the creation Unix-ms timestamp. */
export interface FinishQuestion {
  id: string;
  question: string;
}

/** Questions paired with a finish archive (`<id>.question.json` or `<id>.question.vN.json`). */
export interface FinishQuestionsRecord {
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  /** Finish JSON file this question set belongs to. */
  sourceFinal: string;
  /** Report JSON the questions were grounded in. */
  sourceReport: string;
  questions: FinishQuestion[];
}

/** Answer on a finish archive — references {@link FinishQuestion.id}. */
export interface FinishAnswer {
  questionId: string;
  answer: string;
}

/** Maps finish id → question-file version labels (`v1`, `v2`, …). */
export type FinishSourceQuestions = Record<number, string[]>;

/** @deprecated Legacy Q&A shape; use {@link FinishAnswer} + finish question files. */
interface QAPair {
  /** @deprecated Legacy `qN` ids; new questions use Unix-ms timestamps in question files. */
  id: string;
  question: string;
  answer: string;
  sourceFinal: string;
  sourceReport: string;
}

/** The model's interpretation of what the project is (from README + story). */
export interface ProjectProfile {
  summary: string;
  domains: string[];
  apparentStack: string[];
  keyThemes: string[];
}

/**
 * The model layer of a prepared narrative: a single distilled history, signals
 * copied from the report, four collapsed reasons, and role-aware questionsAnalyses.
 */
export interface PreparedModelLayer {
  changeTypes: string[];
  /** Cleaned, deduped, class-collapsed technology list (e.g. JS subsumed by TS). */
  technologies: string[];
  technicalSignal: Signal;
  architectureSignal: Signal;
  securitySignal: Signal;
  signalReasons: string[];
  questionsAnalyses: QuestionAnalyses[];
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
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  preparedId: number;
  sourceReport: string;
  groupCount: number;
  model: PreparedModelLayer;
  /**
   * @deprecated Answers live on the finish archive + `<finish>.question.json`.
   * Legacy prepared files may still carry this field; readers ignore it.
   */
  answers?: { question: string; answer: string }[];
  /** @deprecated Use finish archive timestamps instead. */
  answeredAt?: string;
}

/**
 * The finish artifact on disk (written by `final` to
 * `~/.workgraph/data/repos/<repo-id>/finish/`): the assembled result plus a link
 * back to the source prepared record. Sits alongside a copy of the result markdown.
 */
export interface FinishRecord {
  finishId: number;
  /** Prepared file this result was built from (no commit hashes). */
  sourcePrepared: string;
  /** The report the prepared record was distilled from (traceability). */
  sourceReport: string;
  /** Repository basename. */
  project: string;
  role: string;
  technologies: string[];
  /** The refined "Your IMPACT" first-person narrative. */
  history: string;
  /** The four Role Narrative impact bullets. */
  narrative: string[];
  /** Four impersonal CV/resume bullets (action-oriented, no "I"). */
  cvBullets: string[];
  /** Cumulative answers; each entry references a question id from a finish question file. */
  answers: FinishAnswer[];
  /** Question rounds by finish id, e.g. `{ 1759696393: ["v1", "v2"] }`. */
  sourceQuestions: FinishSourceQuestions;
  /** File name of the result markdown written next to this record. */
  outputMarkdown: string;
  /** Prior finish archive this record extended (`deepen`). */
  sourcePreviousFinish?: string;
  /**
   * Monotonic version cursor in this finish chain.
   * `1` = initial `final` (`<preparedId>.json`); `2+` = `<preparedId>.vN.json` from `deepen`.
   */
  version: number;
  /** @deprecated Use `version`. Kept when reading legacy archives. */
  round?: number;
  /**
   * Non-code context the developer recalled during this `deepen` round — team decisions,
   * constraints, handoffs, pivots, meetings, why something mattered; not visible in Git.
   * Captured interactively (or via `--context-file`) before new questions are generated.
   * Shapes follow-up questions and refined IMPACT / Role Narrative; stored on the finish
   * archive when non-empty. Not proof of production impact unless the developer stated that.
   */
  recalledContext?: string;
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  provenance: {
    model: string;
    generatedAt: string;
  };
}

/** Token totals for one model or an aggregate bucket. */
export interface TokenTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

/** Per-step LLM token usage persisted in `project.json`. */
interface StepTokenUsage extends TokenTotals {
  lastRunAt: string;
  byModel: Record<string, TokenTotals>;
}

/** Cumulative LLM token usage for a repo (or period-scoped project context). */
export interface ProjectTokenUsage {
  lifetime: TokenTotals & { byModel: Record<string, TokenTotals> };
  steps: Partial<
    Record<
      "init" | "summarize" | "commit-group" | "report" | "prepare" | "final" | "deepen",
      StepTokenUsage
    >
  >;
}

/**
 * Project context captured by `init`, grounding every later LLM call.
 * Stored at `~/.workgraph/data/repos/<repo-id>/project.json`.
 */
export interface ProjectContext {
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
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
  /** Cumulative LLM token usage by pipeline step and model. */
  tokenUsage?: ProjectTokenUsage;
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
 * Pure commit evidence on disk (written by `evidence`). The model layer lives in
 * a sibling `summaries/` file (written by `summarize`).
 */
export interface CommitEvidenceRecord {
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  commitHash: string;
  timestamp: number;
  title: string;
  author: string;
  deterministic: DeterministicLayer;
}

/**
 * Per-commit model interpretation on disk (written by `summarize`), stored next
 * to evidence under `summaries/<timestamp>/<hash>.json`.
 */
export interface CommitSummaryRecord {
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  commitHash: string;
  timestamp: number;
  /** `commits/<sourceEvidence>/<commitHash>.json` — author Unix timestamp directory name. */
  sourceEvidence: string;
  model: ModelLayer;
}

/**
 * Merged commit view: evidence plus an optional model layer (from `summaries/`
 * or, for legacy data, inlined on the evidence file).
 */
export interface CommitRecord extends CommitEvidenceRecord {
  model: ModelLayer | null;
  /** `commits/<sourceEvidence>/<commitHash>.json` — author Unix timestamp directory name. */
  sourceEvidence: string;
  /** Repo-relative path to this commit's summary file (`summaries/…`), if present. */
  sourceSummary: string | null;
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
 * The `groups` block: all member hashes plus their deterministic tier partition
 * and repo-relative paths back to per-commit evidence and summary files.
 */
interface GroupsBlock {
  commits: string[];
  tiers: GroupTiers;
  /** `commits/<sourceEvidence>/<hash>.json` per member, same order as `commits`. */
  sourceEvidence: string[];
  /** Repo-relative summary paths (`summaries/…`), same order as `commits`; `null` when absent. */
  sourceSummaries: (string | null)[];
}

/**
 * The model layer for a group. Like the per-commit model layer but its prose
 * field is a `history` (a fuller account, not a terse summary) instead of
 * `summary`, plus three tiers of **context bullets** (not commit hashes):
 * `hiContext` captures the substantial work, `lowContext` the routine background.
 */
interface GroupModelLayer extends Omit<ModelLayer, "summary" | "questionsAnalysis"> {
  history: string;
  hiContext: string[];
  mediumContext: string[];
  lowContext: string[];
  /** Aggregated reasoned questions: member-commit analyses merged per open thread. */
  questionsAnalyses: QuestionAnalyses[];
}

/**
 * One work-session group on disk (written by `commit-group`).
 */
export interface GroupRecord {
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  groupId: number;
  timestampStart: number;
  timestampEnd: number;
  commitCount: number;
  groups: GroupsBlock;
  deterministic: DeterministicLayer;
  model: GroupModelLayer | null;
}

/**
 * One running history entry inside a cumulative report. Provenance (which group
 * files fed the entry) lives in `deterministic.historySource`, not here — the
 * model layer carries text only.
 */
export interface ReportHistoryEntry {
  text: string;
}

/**
 * Report-specific deterministic evidence: file/churn rollup plus per-entry
 * provenance. `historySource` is parallel to `history` — same length, same
 * indices: `historySource[i]` lists the group files that contributed to
 * `history[i]` (≤ `MAX_HISTORY_ENTRIES`).
 */
export interface ReportDeterministicLayer extends DeterministicLayer {
  historySource: string[][];
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
  /** Aggregated reasoned questions: rebuilt from the folded groups' analyses. */
  questionsAnalyses: QuestionAnalyses[];
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
  /** Encoded package semver when written; absent on legacy files. */
  schemaVersion?: number;
  reportId: number;
  /** Every group file folded into this report (cumulative, including routine-only folds). */
  sourceGroups: string[];
  groupCount: number;
  deterministic: ReportDeterministicLayer;
  model: ReportModelLayer;
  /** Running history of distinct work (text only; provenance in deterministic.historySource). */
  history: ReportHistoryEntry[];
  /**
   * Rolling compaction cursor: 0-based index of the first entry in the next pair
   * to merge when `history` overflows `MAX_HISTORY_ENTRIES`. Advances down the
   * list each time it fires and wraps to 0, so compression is spread evenly
   * across all ages instead of always re-squashing the oldest blob. Absent on
   * legacy records ⇒ treated as 0.
   */
  mergeCursor?: number;
  /**
   * The fold that produced this report: the prior report it built on and the
   * group file folded into it. Absent on a seeded (first) report — nothing was
   * merged.
   */
  mergedFrom?: {
    /** reportId of the prior report this fold built on. */
    previousReportId: number;
    /** File name of the prior report, e.g. "1579390000.json". */
    previousReportFile: string;
    /** Group file folded into the prior report, e.g. "1579390500.json". */
    groupFile: string;
  };
}
