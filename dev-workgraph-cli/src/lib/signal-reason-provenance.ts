// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

export type SignalDimension = "technical" | "architecture" | "security";

/** CLI-attached provenance for a signal reason (schema ≥ 1.0.5). */
export interface SignalReasonProvenance {
  text: string;
  sourceGroupIds: number[];
  sourceCommits?: string[];
}

const MATCH_THRESHOLD = 0.32;

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqNums(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n)))];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Word-overlap score in [0, 1]. */
function textOverlapScore(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const words = (text: string) =>
    new Set(
      text
        .split(/\W+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 3),
    );
  const aWords = words(left);
  const bWords = words(right);
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let shared = 0;
  for (const word of aWords) {
    if (bWords.has(word)) shared += 1;
  }
  return shared / Math.max(aWords.size, bWords.size);
}

export function isSignalReasonProvenance(value: unknown): value is SignalReasonProvenance {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as SignalReasonProvenance).text === "string" &&
    "sourceGroupIds" in value &&
    Array.isArray((value as SignalReasonProvenance).sourceGroupIds)
  );
}

/** Normalizes legacy string or object signal reason to {@link SignalReasonProvenance}. */
export function normalizeSignalReason(
  value: unknown,
  fallbackGroupIds: number[] = [],
): SignalReasonProvenance {
  if (isSignalReasonProvenance(value)) {
    return {
      text: value.text,
      sourceGroupIds: uniqNums(value.sourceGroupIds),
      sourceCommits: value.sourceCommits?.length ? uniq(value.sourceCommits) : undefined,
    };
  }
  const text = typeof value === "string" ? value : "";
  return {
    text,
    sourceGroupIds: uniqNums(fallbackGroupIds),
    sourceCommits: undefined,
  };
}

export function signalReasonText(value: unknown): string {
  if (isSignalReasonProvenance(value)) return value.text;
  return typeof value === "string" ? value : "";
}

/** Maps a report/group reason list to plain text strings. */
export function signalReasonArrayTexts(values: unknown[] | undefined): string[] {
  return (values ?? []).map(signalReasonText).filter((t) => t.trim().length > 0);
}

function emptySignalReasonProvenance(): SignalReasonProvenance {
  return { text: "", sourceGroupIds: [] };
}

function unionSignalReasonProvenance(
  a: SignalReasonProvenance,
  b: SignalReasonProvenance,
): SignalReasonProvenance {
  return {
    text: a.text.trim() ? a.text : b.text,
    sourceGroupIds: uniqNums([...a.sourceGroupIds, ...b.sourceGroupIds]),
    sourceCommits: uniq([...(a.sourceCommits ?? []), ...(b.sourceCommits ?? [])]),
  };
}

/** Finds the best matching reason index, or -1. */
function findMatchingReasonIndex(entries: SignalReasonProvenance[], text: string): number {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const score = textOverlapScore(entry.text, text);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? bestIdx : -1;
}

/** Merges one group reason into a report-level reason array. */
function foldReasonIntoArray(
  prev: SignalReasonProvenance[],
  incoming: SignalReasonProvenance,
): SignalReasonProvenance[] {
  const text = incoming.text.trim();
  if (!text) return prev;
  const idx = findMatchingReasonIndex(prev, text);
  if (idx >= 0) {
    const existing = prev[idx];
    if (!existing) return prev;
    return prev.map((entry, i) =>
      i === idx ? unionSignalReasonProvenance(entry, incoming) : entry,
    );
  }
  return [...prev, incoming];
}

export type ReportSignalReasonArrays = Record<SignalDimension, SignalReasonProvenance[]>;

function emptyReportSignalReasons(): ReportSignalReasonArrays {
  return { technical: [], architecture: [], security: [] };
}

/** Seeds report reason arrays from one migrated group. */
export function seedReportReasonsFromGroup(
  signalReasons: Record<SignalDimension, unknown> | undefined,
  groupId: number,
): ReportSignalReasonArrays {
  const dims: SignalDimension[] = ["technical", "architecture", "security"];
  const out = emptyReportSignalReasons();
  for (const dim of dims) {
    const prov = normalizeSignalReason(signalReasons?.[dim], [groupId]);
    if (prov.text.trim()) out[dim].push(prov);
  }
  return out;
}

/** Folds one group's reasons into cumulative report arrays. */
export function foldGroupIntoReportReasons(
  prev: ReportSignalReasonArrays,
  signalReasons: Record<SignalDimension, unknown> | undefined,
  groupId: number,
): ReportSignalReasonArrays {
  const dims: SignalDimension[] = ["technical", "architecture", "security"];
  const out = { ...prev };
  for (const dim of dims) {
    const incoming = normalizeSignalReason(signalReasons?.[dim], [groupId]);
    out[dim] = foldReasonIntoArray(prev[dim], incoming);
  }
  return out;
}

/** Maps collapsed reason texts to four prepared slots (text only; no provenance matching). */
export function textsToPreparedSignalReasons(texts: string[]): SignalReasonProvenance[] {
  const slots = texts.map((text) => ({ text: text.trim(), sourceGroupIds: [] as number[] }));
  while (slots.length < 4) slots.push(emptySignalReasonProvenance());
  return slots.slice(0, 4);
}

export function commitContributesReason(
  signalReasons: { technical: string; architecture: string; security: string } | undefined,
  dim: SignalDimension,
): boolean {
  return Boolean(signalReasons?.[dim]?.trim());
}

/** Normalizes report model signalReasons arrays to provenance objects. */
export function reportModelToSignalReasonArrays(signalReasons: {
  technical: unknown[];
  architecture: unknown[];
  security: unknown[];
}): ReportSignalReasonArrays {
  const dims: SignalDimension[] = ["technical", "architecture", "security"];
  const out = emptyReportSignalReasons();
  for (const dim of dims) {
    for (const entry of signalReasons[dim] ?? []) {
      const prov = normalizeSignalReason(entry, []);
      if (prov.text.trim()) out[dim].push(prov);
    }
  }
  return out;
}

/** Normalizes prepared signalReasons to four provenance slots. */
export function normalizePreparedSignalReasons(
  values: unknown[] | undefined,
): SignalReasonProvenance[] {
  const slots = (values ?? []).map((v) => normalizeSignalReason(v, []));
  while (slots.length < 4) slots.push(emptySignalReasonProvenance());
  return slots.slice(0, 4);
}
