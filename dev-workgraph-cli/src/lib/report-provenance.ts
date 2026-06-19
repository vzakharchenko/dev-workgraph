// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type {
  DeterministicLayer,
  ReportDeterministicLayer,
  ReportHistoryEntry,
  ReportRecord,
} from "./records.js";

/** Max history entries kept in a report (also caps per-entry provenance rows). */
export const MAX_HISTORY_ENTRIES = 12;

const uniq = (values: string[]): string[] => [...new Set(values)];

type LegacyHistoryEntry = ReportHistoryEntry & { sourceGroups?: string[] };

type DeterministicWithNestedSourceGroups = ReportDeterministicLayer & {
  sourceGroups?: string[];
};

/**
 * Reads cumulative + per-entry group provenance from a report (supports legacy
 * JSON where per-entry `sourceGroups` lived on history entries, a transitional
 * nested `deterministic.sourceGroups`, and the offset `historySource` layout).
 */
export function readReportProvenance(report: ReportRecord): {
  sourceGroups: string[];
  historySources: string[][];
} {
  const history = report.history as LegacyHistoryEntry[];
  const { historySource } = report.deterministic;

  if (report.sourceGroups !== undefined) {
    return {
      sourceGroups: [...report.sourceGroups],
      historySources: (historySource ?? []).map((row) => [...row]),
    };
  }

  const nested = report.deterministic as DeterministicWithNestedSourceGroups;
  if (nested.sourceGroups !== undefined) {
    return {
      sourceGroups: [...nested.sourceGroups],
      historySources: (historySource ?? []).map((row) => [...row]),
    };
  }

  if (historySource && historySource.length > 0) {
    // Transitional offset: row 0 cumulative, rows 1..N aligned with history.
    if (history.length > 0 && historySource.length === history.length + 1) {
      return {
        sourceGroups: [...(historySource[0] ?? [])],
        historySources: historySource.slice(1).map((row) => [...row]),
      };
    }
    return {
      sourceGroups: uniq(historySource.flat()),
      historySources: historySource.map((row) => [...row]),
    };
  }

  return {
    sourceGroups: [],
    historySources: history.map((h) => [...(h.sourceGroups ?? [])]),
  };
}

/** Strips per-entry provenance from history — only `text` belongs there. */
export function historyTextsOnly(history: LegacyHistoryEntry[]): ReportHistoryEntry[] {
  return history.map((h) => ({ text: h.text }));
}

/** Builds the report deterministic layer with `historySource` parallel to `history`. */
export function buildReportDeterministic(
  layer: DeterministicLayer,
  historySources: string[][],
): ReportDeterministicLayer {
  const cappedHistory = historySources.slice(0, MAX_HISTORY_ENTRIES);
  return {
    ...layer,
    historySource: cappedHistory.map((row) => uniq(row)),
  };
}

/** Serializes a report without legacy per-entry provenance on history entries. */
export function stripLegacyProvenance(record: ReportRecord): ReportRecord {
  const det = record.deterministic as DeterministicWithNestedSourceGroups;
  const { sourceGroups: _nested, ...deterministic } = det;
  return {
    ...record,
    deterministic,
    history: historyTextsOnly(record.history as LegacyHistoryEntry[]),
  };
}
