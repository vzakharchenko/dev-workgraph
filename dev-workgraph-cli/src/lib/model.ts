// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Allowed coarse signal levels. No numeric scores (MVP §2). */
export const SIGNALS = ["low", "medium", "high"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Returns the higher of two signal levels on the low < medium < high scale. */
export function maxSignal(a: Signal, b: Signal): Signal {
  return SIGNALS.indexOf(a) >= SIGNALS.indexOf(b) ? a : b;
}

/** Allowed change-type tags (MVP §2). */
export const CHANGE_TYPES = [
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
 * The model-generated interpretation layer of a commit record.
 * This is interpretation, not evidence — it may be wrong.
 */
export interface ModelLayer {
  summary: string;
  changeTypes: string[];
  technicalSignal: Signal;
  architectureSignal: Signal;
  securitySignal: Signal;
  signalReasons: {
    technical: string;
    architecture: string;
    security: string;
  };
  questions: string[];
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
      questions: { type: "array", items: { type: "string" } },
      confidence: signal,
    },
    required: [
      "summary",
      "changeTypes",
      "technicalSignal",
      "architectureSignal",
      "securitySignal",
      "signalReasons",
      "questions",
      "confidence",
    ],
  };
}

/**
 * JSON Schema for the group CLASSIFY session: session-level signals + change
 * types + questions, plus three tiers of **context bullets** (strings, merged
 * by meaning). No `summary` — that is produced separately by the compose step.
 */
export function groupClassifyJsonSchema(): Record<string, unknown> {
  const base = modelJsonSchema();
  const props = { ...(base.properties as Record<string, unknown>) };
  delete props.summary;
  const strArray = { type: "array", items: { type: "string" } };
  const required = (base.required as string[]).filter((field) => field !== "summary");
  return {
    type: "object",
    properties: {
      ...props,
      hiContext: strArray,
      mediumContext: strArray,
      lowContext: strArray,
    },
    required: [...required, "hiContext", "mediumContext", "lowContext"],
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
 * as arrays plus the merged change types, questions, confidence, and re-ranked
 * context tiers.
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
      questions: strArray,
      confidence: { type: "string", enum: [...SIGNALS] },
      hiContext: strArray,
      mediumContext: strArray,
      lowContext: strArray,
    },
    required: [
      "changeTypes",
      "signalReasons",
      "questions",
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

/** JSON Schema for `prepare` step 4: a flat array of reason strings. */
export function prepareReasonsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { signalReasons: { type: "array", items: { type: "string" } } },
    required: ["signalReasons"],
  };
}

/** JSON Schema for `prepare` step 5: role-aware questions + re-assessed confidence. */
export function prepareQuestionsJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      questions: { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: [...SIGNALS] },
    },
    required: ["questions", "confidence"],
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

/** JSON Schema for the "rewrite all running history entries" session. */
export function reportHistoryJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { history: { type: "array", items: { type: "string" } } },
    required: ["history"],
  };
}

/** JSON Schema for the "add the new session's history entry if it adds anything" session. */
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