// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type { ModelLayer } from "./model.js";
import type {
  CommitEvidenceRecord,
  CommitRecord,
  CommitSummaryRecord,
  DeterministicLayer,
  GroupRecord,
  GroupTiers,
  Tier,
} from "./records.js";

const SECONDS_PER_DAY = 86400;

/** Sorted unique helper. */
const uniqSorted = (values: string[]): string[] => [...new Set(values)].sort();

/**
 * Walks `/<ts>/<hash>.json` under a repo data directory.
 * @param dir - Root directory (`commits` or `summaries`).
 */
function listTimestampHashJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      if (f.endsWith(".json")) files.push(path.join(sub, f));
    }
  }
  return files.sort();
}

/**
 * Absolute path to a per-commit summary JSON file.
 * @param summariesDir - The repo's summaries directory.
 * @param timestamp - Commit author timestamp (directory name).
 * @param commitHash - Full commit hash (file basename).
 */
export function commitSummaryPath(
  summariesDir: string,
  timestamp: number,
  commitHash: string,
): string {
  return path.join(summariesDir, String(timestamp), `${commitHash}.json`);
}

/** Evidence directory key under `commits/` (author Unix timestamp as string). */
export function commitEvidenceTimestamp(timestamp: number): string {
  return String(timestamp);
}

/** Repo-relative path to a commit summary JSON file (POSIX separators). */
function commitSummaryRelPath(timestamp: number, commitHash: string): string {
  return path.posix.join("summaries", String(timestamp), `${commitHash}.json`);
}

/**
 * Loads per-commit summary records keyed by commit hash.
 * @param summariesDir - The repo's summaries directory.
 */
function loadSummaryRecords(summariesDir: string): Map<string, CommitSummaryRecord> {
  const byHash = new Map<string, CommitSummaryRecord>();
  for (const file of listTimestampHashJsonFiles(summariesDir)) {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as CommitSummaryRecord;
    byHash.set(record.commitHash, record);
  }
  return byHash;
}

/**
 * Loads every exported commit record for a repo, oldest commit first.
 * Evidence comes from `commits/`; model layers from `summaries/` when given.
 * Legacy evidence files that still inline `model` are supported when no summary
 * file exists for that hash.
 * @param commitsDir - The repo's commits directory.
 * @param summariesDir - Optional summaries directory written by `summarize`.
 */
export function loadCommitRecords(commitsDir: string, summariesDir?: string): CommitRecord[] {
  if (!fs.existsSync(commitsDir)) return [];
  const summaries = summariesDir
    ? loadSummaryRecords(summariesDir)
    : new Map<string, CommitSummaryRecord>();
  const records: CommitRecord[] = [];
  for (const file of listTimestampHashJsonFiles(commitsDir)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CommitEvidenceRecord & {
      model?: ModelLayer | null;
    };
    const { model: legacyModel, ...evidence } = raw;
    const summaryRec = summaries.get(evidence.commitHash);
    const model = summaryRec?.model ?? legacyModel ?? null;
    const sourceEvidence = commitEvidenceTimestamp(evidence.timestamp);
    records.push({
      ...evidence,
      model,
      sourceEvidence,
      sourceSummary: summaryRec
        ? commitSummaryRelPath(evidence.timestamp, evidence.commitHash)
        : null,
    });
  }
  return records.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Splits commits into work-session groups: a new group starts whenever the gap
 * to the previous commit in the current group exceeds `thresholdDays`, OR the
 * current group has reached `maxCommits` commits (a positive cap; 0 = no cap).
 * @param commits - Commit records, oldest first.
 * @param thresholdDays - Max days between consecutive commits within a group.
 * @param maxCommits - Max commits per group (0 or undefined = unlimited).
 */
export function groupByGap(
  commits: CommitRecord[],
  thresholdDays: number,
  maxCommits = 0,
): CommitRecord[][] {
  const gap = thresholdDays * SECONDS_PER_DAY;
  const groups: CommitRecord[][] = [];
  let current: CommitRecord[] = [];

  for (const commit of commits) {
    const prev = current[current.length - 1];
    const gapExceeded = prev !== undefined && commit.timestamp - prev.timestamp > gap;
    const full = maxCommits > 0 && current.length >= maxCommits;
    if (current.length > 0 && (gapExceeded || full)) {
      groups.push(current);
      current = [];
    }
    current.push(commit);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Commit hashes already summarized in on-disk groups that have a model layer.
 * @param groupsDir - The repo's groups directory.
 */
export function coveredCommitHashes(groupsDir: string): Set<string> {
  const covered = new Set<string>();
  for (const { record } of loadGroupRecords(groupsDir)) {
    if (!record.model) continue;
    for (const hash of record.groups.commits) covered.add(hash);
  }
  return covered;
}

/**
 * Drops commits already covered by existing groups. When new commits extend a
 * prior work session, the returned session contains only the uncovered tail so
 * incremental runs do not create duplicate supersets on disk.
 * @param sessions - Work sessions from {@link groupByGap}, oldest first.
 * @param covered - Commit hashes already present in summarized group files.
 */
export function extensionSessions(
  sessions: CommitRecord[][],
  covered: Set<string>,
): CommitRecord[][] {
  const out: CommitRecord[][] = [];
  for (const members of sessions) {
    const uncovered = members.filter((c) => !covered.has(c.commitHash));
    if (uncovered.length > 0) out.push(uncovered);
  }
  return out;
}

/**
 * Loads every group record for a repo with its file name, sorted by
 * `timestampEnd` (oldest session first).
 * @param groupsDir - The repo's groups directory.
 */
export function loadGroupRecords(groupsDir: string): { file: string; record: GroupRecord }[] {
  if (!fs.existsSync(groupsDir)) return [];
  const out: { file: string; record: GroupRecord }[] = [];
  for (const f of fs.readdirSync(groupsDir)) {
    if (!f.endsWith(".json")) continue;
    const record = JSON.parse(fs.readFileSync(path.join(groupsDir, f), "utf8")) as GroupRecord;
    out.push({ file: f, record });
  }
  return out.sort((a, b) => a.record.timestampEnd - b.record.timestampEnd);
}

/**
 * Merges two deterministic layers into one (union of paths, summed churn).
 * @param a - First layer.
 * @param b - Second layer.
 */
export function mergeDeterministic(
  a: DeterministicLayer,
  b: DeterministicLayer,
): DeterministicLayer {
  return {
    changedFiles: {
      added: uniqSorted([...a.changedFiles.added, ...b.changedFiles.added]),
      deleted: uniqSorted([...a.changedFiles.deleted, ...b.changedFiles.deleted]),
      modified: uniqSorted([...a.changedFiles.modified, ...b.changedFiles.modified]),
      renamed: uniqSorted([...a.changedFiles.renamed, ...b.changedFiles.renamed]),
    },
    linesAdded: a.linesAdded + b.linesAdded,
    linesDeleted: a.linesDeleted + b.linesDeleted,
    importantFolders: uniqSorted([...a.importantFolders, ...b.importantFolders]),
    areas: uniqSorted([...a.areas, ...b.areas]),
    excludedFiles: uniqSorted([...a.excludedFiles, ...b.excludedFiles]),
  };
}

/**
 * Aggregates the deterministic layers of a group's member commits into a single
 * group-level deterministic layer (union of paths, summed churn).
 * @param members - Commit records in the group.
 */
export function aggregateDeterministic(members: CommitRecord[]): DeterministicLayer {
  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];
  const renamed: string[] = [];
  const folders: string[] = [];
  const areas: string[] = [];
  const excluded: string[] = [];
  let linesAdded = 0;
  let linesDeleted = 0;

  for (const { deterministic: d } of members) {
    added.push(...d.changedFiles.added);
    deleted.push(...d.changedFiles.deleted);
    modified.push(...d.changedFiles.modified);
    renamed.push(...d.changedFiles.renamed);
    folders.push(...d.importantFolders);
    areas.push(...d.areas);
    excluded.push(...d.excludedFiles);
    linesAdded += d.linesAdded;
    linesDeleted += d.linesDeleted;
  }

  return {
    changedFiles: {
      added: uniqSorted(added),
      deleted: uniqSorted(deleted),
      modified: uniqSorted(modified),
      renamed: uniqSorted(renamed),
    },
    linesAdded,
    linesDeleted,
    importantFolders: uniqSorted(folders),
    areas: uniqSorted(areas),
    excludedFiles: uniqSorted(excluded),
  };
}

/**
 * Classifies a single commit into a signal tier (the deterministic hint):
 * any `high` signal → hi; else any `medium` → medium; else (all low, or no
 * model layer) → low.
 * @param commit - The commit record.
 */
export function tierOf(commit: CommitRecord): Tier {
  const m = commit.model;
  if (!m) return "low";
  const signals = [m.technicalSignal, m.architectureSignal, m.securitySignal];
  if (signals.includes("high")) return "hi";
  if (signals.includes("medium")) return "medium";
  return "low";
}

/**
 * Partitions member commit hashes into signal tiers (deterministic): each hash
 * placed in exactly one of low/medium/hi.
 * @param members - Commit records in the group.
 */
export function partitionTiers(members: CommitRecord[]): GroupTiers {
  const low: string[] = [];
  const medium: string[] = [];
  const hi: string[] = [];
  for (const c of members) {
    const tier = tierOf(c);
    if (tier === "hi") hi.push(c.commitHash);
    else if (tier === "medium") medium.push(c.commitHash);
    else low.push(c.commitHash);
  }
  return { low, medium, hi };
}
