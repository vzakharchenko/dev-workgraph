// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { QuestionAnalyses, QuestionAnalysis } from "./model.js";
import type { CommitRecord, FinishQuestion } from "./records.js";
import type { ReportSignalReasonArrays } from "./signal-reason-provenance.js";

const MATCH_THRESHOLD = 0.32;

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqNums(values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n)))];
}

/** Opaque numeric thread id; use {@link QuestionAnalyses.groupThreadIndex} for position. */
export function makeThreadId(groupId: number, groupThreadIndex: number): string {
  return String(groupId * 1_000_000 + groupThreadIndex);
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

function threadTextLines(thread: QuestionAnalyses): string[] {
  return [...thread.observation, ...thread.missingPiece, ...thread.question];
}

/** Best overlap between two aggregated question threads. */
function threadOverlapScore(a: QuestionAnalyses, b: QuestionAnalyses): number {
  const aLines = threadTextLines(a);
  const bLines = threadTextLines(b);
  if (aLines.length === 0 || bLines.length === 0) return 0;
  let best = 0;
  for (const aLine of aLines) {
    for (const bLine of bLines) {
      best = Math.max(best, textOverlapScore(aLine, bLine));
    }
  }
  return best;
}

function findMatchingInputThreads(
  output: QuestionAnalyses,
  inputs: QuestionAnalyses[],
): QuestionAnalyses[] {
  if (output.derivedFromThreadIds?.length) {
    const byId = inputs.filter(
      (entry) => entry.threadId && output.derivedFromThreadIds?.includes(entry.threadId),
    );
    if (byId.length > 0) return byId;
  }
  const scored = inputs
    .map((entry) => ({ entry, score: threadOverlapScore(output, entry) }))
    .filter((row) => row.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const top = scored[0]?.score ?? 0;
  return scored.filter((row) => row.score >= top * 0.75).map((row) => row.entry);
}

function unionThreadProvenance(threads: QuestionAnalyses[]): {
  derivedFromThreadIds: string[];
  sourceGroupIds: number[];
  sourceCommits: string[];
  sourceGroupId?: number;
} {
  const derivedFromThreadIds = uniq(
    threads.flatMap((thread) => (thread.threadId ? [thread.threadId] : [])),
  );
  const sourceGroupIds = uniqNums(
    threads.flatMap((thread) => {
      if (thread.sourceGroupIds?.length) return thread.sourceGroupIds;
      return thread.sourceGroupId !== undefined ? [thread.sourceGroupId] : [];
    }),
  );
  const sourceCommits = uniq(
    threads.flatMap((thread) => (thread.sourceCommits ?? []).filter(Boolean)),
  );
  return {
    derivedFromThreadIds,
    sourceGroupIds,
    sourceCommits,
    sourceGroupId: sourceGroupIds.at(-1),
  };
}

function matchCommitForText(
  text: string,
  members: CommitRecord[],
): { commitHash: string; sourceSummary: string | null } | null {
  let best: { commitHash: string; sourceSummary: string | null; score: number } | null = null;
  for (const member of members) {
    const candidates = [
      ...(member.model?.questionsAnalysis ?? []).flatMap((entry: QuestionAnalysis) => [
        entry.observation,
        entry.missingPiece,
        entry.question,
      ]),
      member.model?.summary ?? "",
      member.title,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const score = textOverlapScore(text, candidate);
      if (!best || score > best.score) {
        best = {
          commitHash: member.commitHash,
          sourceSummary: member.sourceSummary,
          score,
        };
      }
    }
  }
  if (!best || best.score < MATCH_THRESHOLD) return null;
  return { commitHash: best.commitHash, sourceSummary: best.sourceSummary };
}

function parallelObservationProvenance(
  observations: string[],
  members: CommitRecord[],
  fallbackCommits: string[],
): { sourceCommits: string[]; sourceSummaries: (string | null)[] } {
  const sourceCommits: string[] = [];
  const sourceSummaries: (string | null)[] = [];
  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i] ?? "";
    const match = matchCommitForText(obs, members);
    sourceCommits.push(match?.commitHash ?? fallbackCommits[i] ?? fallbackCommits[0] ?? "");
    sourceSummaries.push(match?.sourceSummary ?? null);
  }
  return { sourceCommits, sourceSummaries };
}

function contributingCommits(thread: QuestionAnalyses, members: CommitRecord[]): string[] {
  const hits: string[] = [];
  for (const member of members) {
    for (const entry of member.model?.questionsAnalysis ?? []) {
      const lines = [entry.observation, entry.missingPiece, entry.question];
      const threadLines = threadTextLines(thread);
      const score = Math.max(
        ...lines.flatMap((line) => threadLines.map((other) => textOverlapScore(line, other))),
        0,
      );
      if (score >= MATCH_THRESHOLD) hits.push(member.commitHash);
    }
  }
  return uniq(hits);
}

/** Attaches commit/group provenance after group classify (code-side). */
export function attachGroupQuestionProvenance(
  analyses: QuestionAnalyses[],
  members: CommitRecord[],
  groupId: number,
): QuestionAnalyses[] {
  return analyses.map((thread, groupThreadIndex) => {
    const fallbackCommits = contributingCommits(thread, members);
    const parallel = parallelObservationProvenance(thread.observation, members, fallbackCommits);
    const sourceGroupIds = uniqNums([groupId, ...(thread.sourceGroupIds ?? [])]);
    return {
      ...thread,
      threadId: thread.threadId ?? makeThreadId(groupId, groupThreadIndex),
      groupThreadIndex,
      sourceGroupId: groupId,
      sourceGroupIds,
      sourceCommits:
        parallel.sourceCommits.filter(Boolean).length > 0
          ? parallel.sourceCommits
          : fallbackCommits,
      sourceSummaries: parallel.sourceSummaries,
    };
  });
}

/** Ensures thread ids on analyses copied from a group into the first report. */
export function seedReportQuestionProvenance(
  analyses: QuestionAnalyses[],
  groupId: number,
): QuestionAnalyses[] {
  return analyses.map((thread, groupThreadIndex) => ({
    ...thread,
    threadId: thread.threadId ?? makeThreadId(groupId, groupThreadIndex),
    groupThreadIndex: thread.groupThreadIndex ?? groupThreadIndex,
    sourceGroupId: thread.sourceGroupId ?? groupId,
    sourceGroupIds: uniqNums([groupId, ...(thread.sourceGroupIds ?? [])]),
  }));
}

/** Unions provenance after report fold merge (code-side, post-LLM). */
export function attachReportMergeProvenance(
  merged: QuestionAnalyses[],
  prevThreads: QuestionAnalyses[],
  groupThreads: QuestionAnalyses[],
  groupId: number,
  reportId: number,
): QuestionAnalyses[] {
  const inputs = [...prevThreads, ...groupThreads];
  return merged.map((thread, index) => {
    const matches = findMatchingInputThreads(thread, inputs);
    const union = unionThreadProvenance(matches);
    const threadId = thread.threadId ?? makeThreadId(reportId, index);
    return {
      ...thread,
      threadId,
      derivedFromThreadIds: uniq([
        ...(thread.derivedFromThreadIds ?? []),
        ...union.derivedFromThreadIds,
      ]),
      sourceGroupIds: uniqNums([
        ...(thread.sourceGroupIds ?? []),
        ...union.sourceGroupIds,
        groupId,
      ]),
      sourceGroupId: thread.sourceGroupId ?? union.sourceGroupId ?? groupId,
      sourceCommits: uniq([...(thread.sourceCommits ?? []), ...union.sourceCommits]),
    };
  });
}

/** Unions provenance after prepare reframe (ID-only; no text matching). */
export function attachPrepareQuestionProvenance(
  reframed: QuestionAnalyses[],
  reportThreads: QuestionAnalyses[],
): QuestionAnalyses[] {
  const threadById = new Map<string, QuestionAnalyses>();
  for (const entry of reportThreads) {
    if (entry.threadId) threadById.set(entry.threadId, entry);
  }
  return reframed.map((thread, threadIndex) => {
    const ids = thread.derivedFromThreadIds ?? [];
    const matches = ids
      .map((id) => threadById.get(id))
      .filter((entry): entry is QuestionAnalyses => entry !== undefined);
    const union = unionThreadProvenance(matches);
    return {
      ...thread,
      threadIndex,
      derivedFromThreadIds: uniq([...ids, ...union.derivedFromThreadIds]),
      sourceGroupIds: uniqNums([...(thread.sourceGroupIds ?? []), ...union.sourceGroupIds]),
      sourceGroupId: thread.sourceGroupId ?? union.sourceGroupId,
      sourceCommits: uniq([...(thread.sourceCommits ?? []), ...union.sourceCommits]),
    };
  });
}

function provenanceFromReportSignalRefs(
  refs: QuestionAnalyses["derivedFromReportSignalRefs"],
  reportSignalReasons: ReportSignalReasonArrays,
): { sourceGroupIds: number[]; sourceCommits: string[] } {
  let sourceGroupIds: number[] = [];
  let sourceCommits: string[] = [];
  for (const ref of refs ?? []) {
    const entry = reportSignalReasons[ref.dimension]?.[ref.index];
    if (!entry) continue;
    sourceGroupIds = uniqNums([...sourceGroupIds, ...entry.sourceGroupIds]);
    sourceCommits = uniq([...sourceCommits, ...(entry.sourceCommits ?? [])]);
  }
  return { sourceGroupIds, sourceCommits };
}

/**
 * Resolves prepare/deepen question lineage from explicit LLM refs (thread ids,
 * report signal catalog indices, prepared signal slots). No text matching.
 */
export function resolvePrepareQuestionProvenanceFromLlm(
  reframed: QuestionAnalyses[],
  reportThreads: QuestionAnalyses[],
  reportSignalReasons: ReportSignalReasonArrays,
): QuestionAnalyses[] {
  const withThreads = attachPrepareQuestionProvenance(reframed, reportThreads);
  return withThreads.map((thread, threadIndex) => {
    const signalProv = provenanceFromReportSignalRefs(
      thread.derivedFromReportSignalRefs,
      reportSignalReasons,
    );
    const slots = thread.derivedFromPreparedSignalSlots ?? [];
    const primarySlot = slots.find((slot) => slot >= 0 && slot <= 3);
    const hasThreadLineage = (thread.derivedFromThreadIds?.length ?? 0) > 0;
    const hasSignalRefs =
      (thread.derivedFromReportSignalRefs?.length ?? 0) > 0 || primarySlot !== undefined;

    const sourceGroupIds = uniqNums([
      ...(thread.sourceGroupIds ?? []),
      ...signalProv.sourceGroupIds,
    ]);
    const sourceCommits = uniq([...(thread.sourceCommits ?? []), ...signalProv.sourceCommits]);

    let lineageKind: QuestionAnalyses["lineageKind"];
    if (hasThreadLineage) lineageKind = "report-thread";
    else if (hasSignalRefs) lineageKind = "signal-reason";

    return {
      ...thread,
      threadIndex,
      sourceGroupIds: sourceGroupIds.length > 0 ? sourceGroupIds : undefined,
      sourceCommits: sourceCommits.length > 0 ? sourceCommits : undefined,
      sourceGroupId: thread.sourceGroupId ?? sourceGroupIds.at(-1),
      lineageKind,
      derivedFromSignalReasonIndex: primarySlot,
    };
  });
}

/** Re-applies prepare question lineage from stored LLM refs (repair / migration). */
export function repairPreparedQuestionLineage(
  questionsAnalyses: QuestionAnalyses[],
  reportThreads: QuestionAnalyses[],
  reportSignalReasons: ReportSignalReasonArrays,
): QuestionAnalyses[] {
  const reframed = questionsAnalyses.map(
    ({ lineageKind, derivedFromSignalReasonIndex, ...rest }) => ({
      ...rest,
    }),
  );
  return resolvePrepareQuestionProvenanceFromLlm(reframed, reportThreads, reportSignalReasons);
}

/** True when any prepared question card lacks group lineage. */
export function needsQuestionLineageRepair(threads: QuestionAnalyses[]): boolean {
  return threads.some((thread) => (thread.sourceGroupIds?.length ?? 0) === 0);
}

/** Maps a prepared thread to finish-question provenance fields. */
export function finishQuestionProvenance(
  thread: QuestionAnalyses | undefined,
  threadIndex: number,
): Pick<
  FinishQuestion,
  | "threadIndex"
  | "derivedFromThreadIds"
  | "sourceGroupIds"
  | "sourceCommits"
  | "sourceGroupId"
  | "lineageKind"
  | "derivedFromSignalReasonIndex"
  | "evidenceExcerpt"
  | "whyAsked"
> {
  if (!thread) return { threadIndex };
  return {
    threadIndex: thread.threadIndex ?? threadIndex,
    derivedFromThreadIds: thread.derivedFromThreadIds,
    sourceGroupIds: thread.sourceGroupIds,
    sourceCommits: uniq((thread.sourceCommits ?? []).filter(Boolean)),
    sourceGroupId: thread.sourceGroupId,
    lineageKind: thread.lineageKind,
    derivedFromSignalReasonIndex: thread.derivedFromSignalReasonIndex,
    evidenceExcerpt: thread.evidenceExcerpt,
    whyAsked: thread.whyAsked,
  };
}
