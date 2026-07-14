// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { cleanQuestionAnalyses, type QuestionAnalyses } from "./model.js";
import type { PreparedModelLayer, PreparedRecord } from "./records.js";

function preparedModelRaw(
  prepared: PreparedRecord | Record<string, unknown>,
): Record<string, unknown> {
  const model = (prepared as PreparedRecord).model ?? (prepared as { model?: unknown }).model;
  return model && typeof model === "object" ? (model as unknown as Record<string, unknown>) : {};
}

/** Reads `questionsAnalyses` from legacy prepared JSON (schema < 1.0.6). */
export function legacyPreparedQuestionAnalyses(
  prepared: PreparedRecord | Record<string, unknown>,
): QuestionAnalyses[] {
  return cleanQuestionAnalyses(preparedModelRaw(prepared).questionsAnalyses);
}

/** Returns a prepared record copy with legacy `questionsAnalyses` set (migration/repair only). */
export function withLegacyPreparedQuestionAnalyses(
  prepared: PreparedRecord,
  threads: QuestionAnalyses[],
): PreparedRecord {
  const model = {
    ...(prepared.model as unknown as Record<string, unknown>),
    questionsAnalyses: threads,
  };
  return { ...prepared, model: model as unknown as PreparedModelLayer };
}

/** Strips legacy `questionsAnalyses` from a prepared model (schema ≥ 1.0.6). */
export function stripLegacyPreparedQuestionAnalyses(prepared: PreparedRecord): PreparedRecord {
  const { questionsAnalyses: _removed, ...model } = preparedModelRaw(prepared);
  return { ...prepared, model: model as unknown as PreparedModelLayer };
}
