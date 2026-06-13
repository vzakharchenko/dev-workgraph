// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type { CommitRecord, DeterministicLayer, GroupTiers, Tier } from "./records.js";

const SECONDS_PER_DAY = 86400;

/** Sorted unique helper. */
const uniqSorted = (values: string[]): string[] => [...new Set(values)].sort();

/**
 * Loads every exported commit record for a repo, oldest commit first.
 * @param commitsDir - The repo's commits directory.
 */
export function loadCommitRecords(commitsDir: string): CommitRecord[] {
  if (!fs.existsSync(commitsDir)) return [];
  const records: CommitRecord[] = [];
  for (const tsDir of fs.readdirSync(commitsDir)) {
    const sub = path.join(commitsDir, tsDir);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      if (!f.endsWith(".json")) continue;
      records.push(JSON.parse(fs.readFileSync(path.join(sub, f), "utf8")) as CommitRecord);
    }
  }
  return records.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Splits commits into work-session groups: a new group starts whenever the gap
 * to the previous commit in the current group exceeds `thresholdDays`.
 * @param commits - Commit records, oldest first.
 * @param thresholdDays - Max days between consecutive commits within a group.
 */
export function groupByGap(commits: CommitRecord[], thresholdDays: number): CommitRecord[][] {
  const gap = thresholdDays * SECONDS_PER_DAY;
  const groups: CommitRecord[][] = [];
  let current: CommitRecord[] = [];

  for (const commit of commits) {
    const prev = current[current.length - 1];
    if (prev && commit.timestamp - prev.timestamp > gap) {
      groups.push(current);
      current = [];
    }
    current.push(commit);
  }
  if (current.length > 0) groups.push(current);
  return groups;
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