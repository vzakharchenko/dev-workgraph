// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { areaOf } from "../lib/areas.js";
import { getRepoConfig, repoCommitsDir } from "../lib/config.js";
import {
  type ChangedFile,
  type Commit,
  getChangedFiles,
  getChurnForPaths,
  getCommits,
  getPatch,
  resolveRepo,
} from "../lib/git.js";
import { isNoise } from "../lib/noise.js";
import { filterPatchNoise, MAX_PATCH_CHARS, packPatchIntoParts } from "../lib/patch-split.js";
import { resolvePeriodRange } from "../lib/periods.js";
import { writeRecordJson } from "../lib/record-io.js";
import type {
  CommitEvidencePartRecord,
  CommitEvidenceRecord,
  DeterministicLayer,
} from "../lib/records.js";
import { uniqSorted } from "../lib/sort.js";

/**
 * Options for the `evidence` command.
 */
export interface EvidenceOptions {
  /** Path to the repository (relative or absolute). */
  repo: string;
  /** Override the saved author selection with these emails. */
  email?: string[];
  /** Restrict extraction to a defined review period (scopes output too). */
  period?: string;
}

/**
 * Builds the deterministic layer for a commit from its changed files and churn.
 * Noise files are routed to `excludedFiles` and kept out of every other list.
 * @param repoPath - Absolute repository path.
 * @param hash - Commit hash.
 * @param onlyPaths - When set, only these repository-relative paths are included.
 */
function buildDeterministic(
  repoPath: string,
  hash: string,
  onlyPaths?: ReadonlySet<string>,
): DeterministicLayer {
  const files = getChangedFiles(repoPath, hash);

  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];
  const renamed: string[] = [];
  const excluded: string[] = [];
  const folders: string[] = [];
  const areas: string[] = [];

  for (const file of files) {
    if (onlyPaths && !pathMatchesScope(file, onlyPaths)) continue;

    if (isNoise(file.path)) {
      excluded.push(file.path);
      continue;
    }
    classify(file, { added, deleted, modified, renamed });

    const dir = path.posix.dirname(file.path);
    if (dir && dir !== ".") folders.push(dir);
    areas.push(areaOf(file.path));
  }

  const pathFilter = onlyPaths ? new Set([...onlyPaths].filter((p) => !isNoise(p))) : undefined;
  const churn = getChurnForPaths(repoPath, hash, isNoise, pathFilter);

  return {
    changedFiles: {
      added: uniqSorted(added),
      deleted: uniqSorted(deleted),
      modified: uniqSorted(modified),
      renamed: uniqSorted(renamed),
    },
    linesAdded: churn.added,
    linesDeleted: churn.deleted,
    importantFolders: uniqSorted(folders),
    areas: uniqSorted(areas),
    excludedFiles: uniqSorted(excluded),
  };
}

/**
 * True when a changed file falls within a part's path scope (including rename old paths).
 */
function pathMatchesScope(file: ChangedFile, scope: ReadonlySet<string>): boolean {
  if (scope.has(file.path)) return true;
  return file.oldPath !== undefined && scope.has(file.oldPath);
}

/**
 * Routes a changed file into the correct status bucket.
 */
function classify(
  file: ChangedFile,
  buckets: { added: string[]; deleted: string[]; modified: string[]; renamed: string[] },
): void {
  switch (file.status) {
    case "A":
      buckets.added.push(file.path);
      break;
    case "D":
      buckets.deleted.push(file.path);
      break;
    case "R":
    case "C":
      buckets.renamed.push(file.oldPath ? `${file.oldPath} => ${file.path}` : file.path);
      break;
    default: // M, T, and anything else → modified
      buckets.modified.push(file.path);
  }
}

/**
 * Append-only: true when a commit export is already complete on disk.
 */
function isFullyExtracted(dir: string, hash: string): boolean {
  const jsonPath = path.join(dir, `${hash}.json`);
  if (!fs.existsSync(jsonPath)) return false;

  const record = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as CommitEvidenceRecord;
  if (record.split) {
    const partCount = record.partCount ?? 0;
    if (partCount < 1) return false;
    for (let part = 1; part <= partCount; part += 1) {
      const partJson = path.join(dir, `${hash}.part${part}.json`);
      const partPatch = path.join(dir, `${hash}.part${part}.patch`);
      if (!fs.existsSync(partJson) || !fs.existsSync(partPatch)) return false;
    }
    return true;
  }

  return fs.existsSync(path.join(dir, `${hash}.patch`));
}

function writeSmallCommit(repoPath: string, dir: string, commit: Commit, patch: string): void {
  const patchPath = path.join(dir, `${commit.hash}.patch`);
  const jsonPath = path.join(dir, `${commit.hash}.json`);

  fs.writeFileSync(patchPath, `${patch}\n`, "utf8");

  const record: CommitEvidenceRecord = {
    commitHash: commit.hash,
    timestamp: commit.timestamp,
    title: commit.subject,
    author: commit.email,
    deterministic: buildDeterministic(repoPath, commit.hash),
  };
  writeRecordJson(jsonPath, record);
}

function writeSplitCommit(repoPath: string, dir: string, commit: Commit, patch: string): void {
  const parts = packPatchIntoParts(patch);
  const partCount = parts.length;
  const jsonPath = path.join(dir, `${commit.hash}.json`);

  const manifest: CommitEvidenceRecord = {
    commitHash: commit.hash,
    timestamp: commit.timestamp,
    title: commit.subject,
    author: commit.email,
    split: true,
    partCount,
    deterministic: buildDeterministic(repoPath, commit.hash),
  };
  writeRecordJson(jsonPath, manifest);

  for (const [index, part] of parts.entries()) {
    const partNum = index + 1;
    const scope = new Set(part.paths);
    const partRecord: CommitEvidencePartRecord = {
      commitHash: commit.hash,
      timestamp: commit.timestamp,
      title: commit.subject,
      author: commit.email,
      part: partNum,
      partCount,
      patchTruncated: part.patchTruncated,
      deterministic: buildDeterministic(repoPath, commit.hash, scope),
    };
    fs.writeFileSync(path.join(dir, `${commit.hash}.part${partNum}.patch`), part.patch, "utf8");
    writeRecordJson(path.join(dir, `${commit.hash}.part${partNum}.json`), partRecord);
  }
}

/**
 * Writes the patch and deterministic JSON for one commit.
 * @param repoPath - Absolute repository path.
 * @param outDir - The repo's commits directory.
 * @param commit - The commit to extract evidence for.
 * @returns "extracted" when written, "skipped" when it already existed.
 */
function extractOne(repoPath: string, outDir: string, commit: Commit): "extracted" | "skipped" {
  const dir = path.join(outDir, String(commit.timestamp));

  if (isFullyExtracted(dir, commit.hash)) {
    return "skipped";
  }

  fs.mkdirSync(dir, { recursive: true });
  const patch = filterPatchNoise(getPatch(repoPath, commit.hash), isNoise);

  if (patch.length <= MAX_PATCH_CHARS) {
    writeSmallCommit(repoPath, dir, commit, patch);
  } else {
    writeSplitCommit(repoPath, dir, commit, patch);
  }

  return "extracted";
}

/**
 * Extracts evidence — patch + deterministic JSON — for every commit authored by
 * the selected identities, oldest-first, into
 * `~/.workgraph/data/commits/<timestamp>/<hash>.{patch,json}` (or split parts).
 * @param options - Resolved command options.
 */
export async function evidence(options: EvidenceOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);

  const emails =
    options.email && options.email.length > 0
      ? options.email.map((e) => e.toLowerCase())
      : getRepoConfig(repoPath)?.selectedAuthors;

  if (!emails || emails.length === 0) {
    console.error("✖ No authors selected. Run `dev-workgraph authors` first, or pass --email.");
    process.exitCode = 1;
    return;
  }

  const range = options.period ? resolvePeriodRange(repoPath, options.period) : undefined;
  const commits = getCommits(repoPath, emails, range);
  if (commits.length === 0) {
    console.log(
      options.period
        ? `No commits found for the selected authors in period "${options.period}".`
        : "No commits found for the selected authors.",
    );
    return;
  }

  const outDir = repoCommitsDir(repoPath, options.period);
  console.log(
    `Extracting evidence for ${commits.length} commit(s) by ${emails.join(", ")}${
      options.period ? ` in period "${options.period}"` : ""
    } → ${outDir}`,
  );

  let extracted = 0;
  let skipped = 0;
  for (const commit of commits) {
    const result = extractOne(repoPath, outDir, commit);
    if (result === "extracted") extracted += 1;
    else skipped += 1;
  }

  console.log(`\n✅ Done. Extracted ${extracted}, skipped ${skipped} (already present).`);
}
