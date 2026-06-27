// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Allowed coarse signal levels. No numeric scores (MVP §2). */
const SIGNALS = ["low", "medium", "high"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Returns the higher of two signal levels on the low < medium < high scale. */
export function maxSignal(a: Signal, b: Signal): Signal {
  return SIGNALS.indexOf(a) >= SIGNALS.indexOf(b) ? a : b;
}

/** Allowed change-type tags (MVP §2). */
const CHANGE_TYPES = [
  "feature",
  "bugfix",
  "refactoring",
  "security",
  "infrastructure",
  "testing",
  "configuration",
  "developer-tooling",
  "architecture",
  "documentation",
  "deployment",
] as const;

/**
 * One reasoned open question on a single commit: what the diff shows, the human
 * context the diff cannot establish, and the question to recover it. All three
 * fields are English prose.
 */
export interface QuestionAnalysis {
  /** What the diff actually shows (grounded in the patch, not the commit message). */
  observation: string;
  /** The human context the patch cannot establish (ownership, intent, production use, …). */
  missingPiece: string;
  /** The single question to ask the human to recover that missing context. */
  question: string;
}

/**
 * The aggregated form of {@link QuestionAnalysis} used at group and report level.
 * Because a group/report merges several commits, each field is an ARRAY: the
 * merged observations, the merged missing pieces, and the merged questions that
 * belong to one coherent open thread.
 */
export interface QuestionAnalyses {
  observation: string[];
  missingPiece: string[];
  question: string[];
}

/**
 * The model-generated interpretation layer of a commit record.
 * This is interpretation, not evidence — it may be wrong.
 */
export interface ModelLayer {
  summary: string;
  changeTypes: string[];
  /** Languages, frameworks, tools, and libraries the patch actually uses. */
  technologies: string[];
  technicalSignal: Signal;
  architectureSignal: Signal;
  securitySignal: Signal;
  signalReasons: {
    technical: string;
    architecture: string;
    security: string;
  };
  /** Reasoned open questions: observation → missing piece → question (English). */
  questionsAnalysis: QuestionAnalysis[];
  confidence: Signal;
  /** Provenance attached by the CLI after generation (not produced by the model). */
  provenance?: {
    model: string;
    generatedAt: string;
    patchTruncated: boolean;
  };
}

/**
 * JSON Schema passed to Ollama's `format` parameter to force a structured,
 * schema-valid response. Mirrors {@link ModelLayer} minus provenance.
 */
export function modelJsonSchema(): Record<string, unknown> {
  const signal = { type: "string", enum: [...SIGNALS] };
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      changeTypes: { type: "array", items: { type: "string", enum: [...CHANGE_TYPES] } },
      technologies: { type: "array", items: { type: "string" } },
      technicalSignal: signal,
      architectureSignal: signal,
      securitySignal: signal,
      signalReasons: {
        type: "object",
        properties: {
          technical: { type: "string" },
          architecture: { type: "string" },
          security: { type: "string" },
        },
        required: ["technical", "architecture", "security"],
      },
      questionsAnalysis: {
        type: "array",
        items: {
          type: "object",
          properties: {
            observation: { type: "string" },
            missingPiece: { type: "string" },
            question: { type: "string" },
          },
          required: ["observation", "missingPiece", "question"],
        },
      },
      confidence: signal,
    },
    required: [
      "summary",
      "changeTypes",
      "technologies",
      "technicalSignal",
      "architectureSignal",
      "securitySignal",
      "signalReasons",
      "questionsAnalysis",
      "confidence",
    ],
  };
}

/**
 * JSON Schema for the group CLASSIFY session: session-level signals + change
 * types + questionsAnalyses, plus three tiers of **context bullets** (strings, merged
 * by meaning). No `summary` — that is produced separately by the compose step.
 */
export function groupClassifyJsonSchema(): Record<string, unknown> {
  const base = modelJsonSchema();
  const props = { ...(base.properties as Record<string, unknown>) };
  // `summary` is produced by the compose step; `technologies` is a deterministic
  // union of the member commits; the per-commit `questionsAnalysis` is replaced by
  // the aggregated `questionsAnalyses` below — none of these is re-derived here.
  delete props.summary;
  delete props.technologies;
  delete props.questionsAnalysis;
  delete props.questions;
  const strArray = { type: "array", items: { type: "string" } };
  const required = (base.required as string[]).filter(
    (field) =>
      field !== "summary" &&
      field !== "technologies" &&
      field !== "questionsAnalysis" &&
      field !== "questions",
  );
  return {
    type: "object",
    properties: {
      ...props,
      questionsAnalyses: aggregatedQuestionAnalysisSchema(),
      hiContext: strArray,
      mediumContext: strArray,
      lowContext: strArray,
    },
    required: [...required, "questionsAnalyses", "hiContext", "mediumContext", "lowContext"],
  };
}

/** JSON Schema for the aggregated `questionsAnalyses` (group/report): array-valued fields. */
function aggregatedQuestionAnalysisSchema(): Record<string, unknown> {
  const strArray = { type: "array", items: { type: "string" } };
  return {
    type: "array",
    items: {
      type: "object",
      properties: { observation: strArray, missingPiece: strArray, question: strArray },
      required: ["observation", "missingPiece", "question"],
    },
  };
}

/**
 * JSON Schema for the group COMPOSE session: a single merged HISTORY (a fuller
 * account) built from the classified tiers and the member commits' summaries.
 */
export function groupHistoryJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { history: { type: "string" } },
    required: ["history"],
  };
}

/**
 * JSON Schema for the report MERGE session: combines two model layers. Signal
 * *levels* are computed in code (max), so the model only returns `signalReasons`
 * as arrays plus the merged change types, questionsAnalyses, confidence, and
 * re-ranked context tiers.
 */
export function reportMergeJsonSchema(): Record<string, unknown> {
  const strArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      changeTypes: { type: "array", items: { type: "string", enum: [...CHANGE_TYPES] } },
      signalReasons: {
        type: "object",
        properties: { technical: strArray, architecture: strArray, security: strArray },
        required: ["technical", "architecture", "security"],
      },
      questionsAnalyses: aggregatedQuestionAnalysisSchema(),
      confidence: { type: "string", enum: [...SIGNALS] },
      hiContext: strArray,
      mediumContext: strArray,
      lowContext: strArray,
    },
    required: [
      "changeTypes",
      "signalReasons",
      "questionsAnalyses",
      "confidence",
      "hiContext",
      "mediumContext",
      "lowContext",
    ],
  };
}

/** JSON Schema for `init` session 1: the role-adjusted prepared story context. */
export function storyPrepareJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { preparedContext: { type: "string" } },
    required: ["preparedContext"],
  };
}

/** JSON Schema for `init` session 2: the structured project profile. */
export function projectProfileJsonSchema(): Record<string, unknown> {
  const strArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      domains: strArray,
      apparentStack: strArray,
      keyThemes: strArray,
    },
    required: ["summary", "domains", "apparentStack", "keyThemes"],
  };
}

/** JSON Schema for `final`: the Role Narrative — four impact bullet points. */
export function roleNarrativeJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { narrative: { type: "array", items: { type: "string" } } },
    required: ["narrative"],
  };
}

/** JSON Schema for `final`: four impersonal CV/resume bullet points. */
export function cvBulletsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { cvBullets: { type: "array", items: { type: "string" } } },
    required: ["cvBullets"],
  };
}

/**
 * Case-insensitively unions technology lists, preserving the first-seen casing
 * and order. Used to accumulate `technologies` across commits → groups → report
 * (deterministic, no model). The model only cleans/collapses the list at `prepare`.
 * @param lists - Technology arrays to merge.
 */
export function mergeTechnologies(...lists: (string[] | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const tech = typeof raw === "string" ? raw.trim() : "";
      if (!tech) continue;
      const key = tech.toLowerCase();
      if (!seen.has(key)) seen.set(key, tech);
    }
  }
  return [...seen.values()];
}

/** JSON Schema for `prepare`: the cleaned/deduped technology list. */
export function prepareTechnologiesJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { technologies: { type: "array", items: { type: "string" } } },
    required: ["technologies"],
  };
}

/** JSON Schema for `prepare` step 4: a flat array of reason strings. */
export function prepareReasonsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { signalReasons: { type: "array", items: { type: "string" } } },
    required: ["signalReasons"],
  };
}

/** JSON Schema for `prepare` step 5: role-aware questionsAnalyses + re-assessed confidence. */
export function prepareQuestionsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      questionsAnalyses: aggregatedQuestionAnalysisSchema(),
      confidence: { type: "string", enum: [...SIGNALS] },
    },
    required: ["questionsAnalyses", "confidence"],
  };
}

/** JSON Schema for the report routine-gate classifier (step 1). */
export function routineCheckJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      routine: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["routine"],
  };
}

/** JSON Schema for the report history compaction session (text strings only). */
export function reportHistoryJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { history: { type: "array", items: { type: "string" } } },
    required: ["history"],
  };
}

/** JSON Schema for add-if-new: `{ needed, text }` only — provenance is code-side. */
export function reportNewHistoryJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      needed: { type: "boolean" },
      text: { type: "string" },
    },
    required: ["needed", "text"],
  };
}

/** Flattens aggregated analyses into question strings (display / Q&A order). */
export function flattenQuestions(analyses: QuestionAnalyses[]): string[] {
  return analyses.flatMap((a) => a.question);
}

/**
 * Cleans a raw per-commit `questionsAnalysis` value (from model output): trims
 * each field and drops entries that carry no `question`.
 * @param raw - The raw value.
 */
export function cleanQuestionAnalysis(raw: unknown): QuestionAnalysis[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => {
      const entry = (q ?? {}) as Partial<QuestionAnalysis>;
      return {
        observation: String(entry.observation ?? "").trim(),
        missingPiece: String(entry.missingPiece ?? "").trim(),
        question: String(entry.question ?? "").trim(),
      };
    })
    .filter((q) => q.question);
}

/**
 * Cleans a raw aggregated `questionsAnalyses` value (group/report): trims and
 * compacts each array field and drops entries that end up with no question.
 * @param raw - The raw value.
 */
export function cleanQuestionAnalyses(raw: unknown): QuestionAnalyses[] {
  if (!Array.isArray(raw)) return [];
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
  return raw
    .map((q) => {
      const entry = (q ?? {}) as Partial<QuestionAnalyses>;
      return {
        observation: strArray(entry.observation),
        missingPiece: strArray(entry.missingPiece),
        question: strArray(entry.question),
      };
    })
    .filter((q) => q.question.length > 0);
}

/**
 * Enforces the "no signal without a reason" rule: any non-low signal whose
 * reason is empty is demoted to "low". Returns the corrected layer.
 * @param layer - The raw model output.
 */
export function enforceSignalReasons(layer: ModelLayer): ModelLayer {
  const demote = (signal: Signal, reason: string): Signal =>
    signal !== "low" && !reason.trim() ? "low" : signal;

  return {
    ...layer,
    technicalSignal: demote(layer.technicalSignal, layer.signalReasons.technical),
    architectureSignal: demote(layer.architectureSignal, layer.signalReasons.architecture),
    securitySignal: demote(layer.securitySignal, layer.signalReasons.security),
  };
}
