// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type { QuestionAnalyses } from "../../model.js";
import {
  attachGroupQuestionProvenance,
  makeThreadId,
  seedReportQuestionProvenance,
} from "../../question-provenance.js";
import type {
  CommitRecord,
  CommitSummaryRecord,
  FinishQuestion,
  FinishQuestionsRecord,
  FinishRecord,
  GroupRecord,
  PreparedRecord,
  ReportRecord,
} from "../../records.js";
import {
  repairFinishQuestionsRecordLineage,
  repairPreparedRecordQuestionLineage,
} from "../../repair-question-lineage.js";
import {
  commitContributesReason,
  foldGroupIntoReportReasons,
  isSignalReasonProvenance,
  normalizePreparedSignalReasons,
  normalizeSignalReason,
  type ReportSignalReasonArrays,
  type SignalDimension,
  type SignalReasonProvenance,
  seedReportReasonsFromGroup,
  signalReasonText,
} from "../../signal-reason-provenance.js";
import { readRecordJson } from "../io.js";
import type { MigrationContext } from "../types.js";

const DIMENSIONS: SignalDimension[] = ["technical", "architecture", "security"];

const EMPTY_DETERMINISTIC: CommitRecord["deterministic"] = {
  changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
  linesAdded: 0,
  linesDeleted: 0,
  importantFolders: [],
  areas: [],
  excludedFiles: [],
};

/** Legacy threads missing CLI-attached lineage (schema < 1.0.5). */
function needsQuestionProvenanceRepair(threads: QuestionAnalyses[]): boolean {
  return threads.some((thread) => !thread.threadId || (thread.sourceGroupIds?.length ?? 0) === 0);
}

function loadGroupMembersFromSummaries(group: GroupRecord, ctx: MigrationContext): CommitRecord[] {
  const block = group.groups;
  if (!block?.commits) return [];

  const members: CommitRecord[] = [];
  for (let i = 0; i < block.commits.length; i += 1) {
    const commitHash = block.commits[i];
    if (!commitHash) continue;
    const relSummary = block.sourceSummaries?.[i] ?? null;
    const summaryPath = relSummary ? path.join(ctx.dataRoot, relSummary) : null;
    let summary: CommitSummaryRecord | null = null;
    if (summaryPath && fs.existsSync(summaryPath)) {
      summary = readRecordJson(summaryPath) as unknown as CommitSummaryRecord;
    }
    const sourceEvidence =
      block.sourceEvidence?.[i] ?? String(summary?.timestamp ?? group.timestampEnd);
    members.push({
      commitHash,
      timestamp: summary?.timestamp ?? group.timestampEnd,
      title: summary?.model?.summary?.slice(0, 120) ?? commitHash.slice(0, 8),
      author: "",
      deterministic: EMPTY_DETERMINISTIC,
      model: summary?.model ?? null,
      sourceEvidence,
      sourceSummary: relSummary,
    });
  }
  return members;
}

function loadGroupRecord(groupsDir: string, fileName: string): GroupRecord | null {
  const filePath = path.join(groupsDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  return readRecordJson(filePath) as unknown as GroupRecord;
}

function loadSummaryModel(
  ctx: MigrationContext,
  relSummary: string | null,
): { signalReasons?: { technical: string; architecture: string; security: string } } | null {
  if (!relSummary) return null;
  const summaryPath = path.join(ctx.dataRoot, relSummary);
  if (!fs.existsSync(summaryPath)) return null;
  try {
    const record = readRecordJson(summaryPath) as {
      model?: { signalReasons?: { technical: string; architecture: string; security: string } };
    };
    return record.model ?? null;
  } catch {
    return null;
  }
}

function collectCommitsForDimension(
  group: GroupRecord,
  ctx: MigrationContext,
  dim: SignalDimension,
): string[] {
  const commits: string[] = [];
  const block = group.groups;
  if (!block?.commits) return commits;
  for (let i = 0; i < block.commits.length; i += 1) {
    const hash = block.commits[i];
    if (!hash) continue;
    const model = loadSummaryModel(ctx, block.sourceSummaries?.[i] ?? null);
    if (commitContributesReason(model?.signalReasons, dim)) commits.push(hash);
  }
  return commits;
}

function migrateGroupSignalReasons(group: GroupRecord, ctx: MigrationContext): GroupRecord {
  if (!group.model) return group;
  const groupId = group.timestampEnd;
  const signalReasons = { ...group.model.signalReasons } as Record<SignalDimension, unknown>;
  const migrated: Record<SignalDimension, SignalReasonProvenance> = {
    technical: emptyMigratedReason(),
    architecture: emptyMigratedReason(),
    security: emptyMigratedReason(),
  };

  for (const dim of DIMENSIONS) {
    const raw = signalReasons[dim];
    if (isSignalReasonProvenance(raw)) {
      migrated[dim] = normalizeSignalReason(raw, [groupId]);
      continue;
    }
    const text = signalReasonText(raw);
    migrated[dim] = {
      text,
      sourceGroupIds: text.trim() ? [groupId] : [],
      sourceCommits: text.trim() ? collectCommitsForDimension(group, ctx, dim) : [],
    };
  }

  return {
    ...group,
    model: {
      ...group.model,
      signalReasons: migrated,
    },
  };
}

function emptyMigratedReason(): SignalReasonProvenance {
  return { text: "", sourceGroupIds: [] };
}

function migrateReportReasonsInline(record: ReportRecord): ReportSignalReasonArrays {
  const raw = record.model.signalReasons;
  const out: ReportSignalReasonArrays = {
    technical: [],
    architecture: [],
    security: [],
  };
  for (const dim of DIMENSIONS) {
    const entries = raw[dim] ?? [];
    for (const entry of entries) {
      const prov = normalizeSignalReason(entry, []);
      if (prov.text.trim()) out[dim].push(prov);
    }
  }
  return out;
}

function replayReportSignalReasons(
  record: ReportRecord,
  ctx: MigrationContext,
): ReportSignalReasonArrays {
  const groupFiles = record.sourceGroups ?? [];
  if (groupFiles.length === 0) return migrateReportReasonsInline(record);

  const first = loadGroupRecord(ctx.groupsDir, groupFiles[0] ?? "");
  if (!first?.model) return migrateReportReasonsInline(record);

  let reasons = seedReportReasonsFromGroup(
    first.model.signalReasons as Record<SignalDimension, unknown>,
    first.timestampEnd,
  );

  for (let i = 1; i < groupFiles.length; i += 1) {
    const group = loadGroupRecord(ctx.groupsDir, groupFiles[i] ?? "");
    if (!group?.model) continue;
    reasons = foldGroupIntoReportReasons(
      reasons,
      group.model.signalReasons as Record<SignalDimension, unknown>,
      group.timestampEnd,
    );
  }

  return reasons;
}

function migrateReportQuestions(record: ReportRecord, ctx: MigrationContext): QuestionAnalyses[] {
  const threads = record.model.questionsAnalyses ?? [];
  if (!needsQuestionProvenanceRepair(threads)) return threads;

  const groupIds = (record.sourceGroups ?? [])
    .map((file) => loadGroupRecord(ctx.groupsDir, file)?.timestampEnd)
    .filter((id): id is number => id !== undefined);

  if (record.sourceGroups?.length === 1 && groupIds[0] !== undefined) {
    return seedReportQuestionProvenance(threads, groupIds[0]);
  }

  return threads.map((thread, index) => ({
    ...thread,
    threadId: thread.threadId ?? makeThreadId(record.reportId, index),
    sourceGroupIds: thread.sourceGroupIds?.length ? thread.sourceGroupIds : groupIds,
    sourceGroupId: thread.sourceGroupId ?? groupIds.at(-1),
  }));
}

export function migrateGroupRecord(record: GroupRecord, ctx: MigrationContext): GroupRecord {
  const withReasons = migrateGroupSignalReasons(record, ctx);
  if (!withReasons.model?.questionsAnalyses?.length) return withReasons;

  const groupId = withReasons.timestampEnd;
  const analyses = withReasons.model.questionsAnalyses;
  if (!needsQuestionProvenanceRepair(analyses)) return withReasons;

  return {
    ...withReasons,
    model: {
      ...withReasons.model,
      questionsAnalyses: attachGroupQuestionProvenance(
        analyses,
        loadGroupMembersFromSummaries(withReasons, ctx),
        groupId,
      ),
    },
  };
}

export function migrateReportRecord(record: ReportRecord, ctx: MigrationContext): ReportRecord {
  const signalReasons = replayReportSignalReasons(record, ctx);
  const questionsAnalyses = migrateReportQuestions(record, ctx);
  return {
    ...record,
    model: {
      ...record.model,
      signalReasons: signalReasons as unknown as ReportRecord["model"]["signalReasons"],
      questionsAnalyses,
    },
  };
}

export function migratePreparedRecord(
  record: PreparedRecord,
  ctx: MigrationContext,
): PreparedRecord {
  const collapsed = normalizePreparedSignalReasons(record.model.signalReasons);
  let prepared: PreparedRecord = {
    ...record,
    model: {
      ...record.model,
      signalReasons: collapsed as unknown as PreparedRecord["model"]["signalReasons"],
    },
  };

  const threads = prepared.model.questionsAnalyses;
  if (threads?.length && needsQuestionProvenanceRepair(threads)) {
    prepared = repairPreparedRecordQuestionLineage(prepared, ctx);
  }

  return prepared;
}

function preparedFileNameFromFinishSource(sourceFinal: string): string {
  const base = path.basename(sourceFinal);
  const match = /^(\d+)(?:\.v\d+)?\.json$/i.exec(base);
  return match ? `${match[1]}.json` : base;
}

export function migrateFinishQuestionsRecord(
  record: FinishQuestionsRecord,
  ctx: MigrationContext,
): FinishQuestionsRecord {
  const preparedPath = path.join(
    ctx.preparedDir,
    preparedFileNameFromFinishSource(record.sourceFinal),
  );
  let prepared: PreparedRecord | null = null;
  if (fs.existsSync(preparedPath)) {
    prepared = readRecordJson(preparedPath) as unknown as PreparedRecord;
    if ((prepared.schemaVersion ?? 0) < 1_000_005) {
      prepared = migratePreparedRecord(prepared, ctx);
    } else {
      prepared = repairPreparedRecordQuestionLineage(prepared, ctx);
    }
  }

  const preparedThreads = prepared?.model.questionsAnalyses ?? record.questionsAnalyses ?? [];
  const questions: FinishQuestion[] = record.questions.map((q: FinishQuestion, i: number) => {
    const threadIndex = q.threadIndex ?? i;
    const thread = preparedThreads[threadIndex];
    if (!thread) return q;

    return {
      ...q,
      threadIndex,
      derivedFromThreadIds: thread.derivedFromThreadIds ?? q.derivedFromThreadIds,
      sourceGroupIds: thread.sourceGroupIds ?? q.sourceGroupIds,
      sourceCommits: thread.sourceCommits ?? q.sourceCommits,
      sourceGroupId: thread.sourceGroupId ?? q.sourceGroupId,
      lineageKind: thread.lineageKind,
      derivedFromSignalReasonIndex: thread.derivedFromSignalReasonIndex,
    };
  });

  const next: FinishQuestionsRecord = {
    ...record,
    questions,
    questionsAnalyses: preparedThreads.length > 0 ? preparedThreads : record.questionsAnalyses,
  };

  return repairFinishQuestionsRecordLineage(next, ctx);
}

export function migrateFinishRecord(record: FinishRecord): FinishRecord {
  return record;
}
