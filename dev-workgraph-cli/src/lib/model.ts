// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Allowed coarse signal levels. No numeric scores (MVP §2). */
export const SIGNALS = ["low", "medium", "high"] as const;
export type Signal = (typeof SIGNALS)[number];

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
 * JSON Schema for the group COMPOSE session: a single merged narrative built
 * from the classified tiers and the member commits' summaries.
 */
export function groupComposeJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
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