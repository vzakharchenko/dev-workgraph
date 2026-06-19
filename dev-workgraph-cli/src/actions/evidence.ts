// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { areaOf } from "../lib/areas.js";
import { getRepoConfig, repoCommitsDir } from "../lib/config.js";
import {
  type ChangedFile,
  type Commit,
  getChangedFiles,
  getChurn,
  getCommits,
  getPatch,
  resolveRepo,
} from "../lib/git.js";
import { isNoise } from "../lib/noise.js";
import { resolvePeriodRange } from "../lib/periods.js";

/**
 * Options for the `evidence` command.
 */
export interface EvidenceOptions {
  /** Path to the repository (relative or absolute). */
  repo: string;
  /** Override the saved author selection with these emails. */
  email?: string[];
  /** Re-extract and overwrite commits that already exist on disk. */
  force?: boolean;
  /** Restrict extraction to a defined review period (scopes output too). */
  period?: string;
}

/**
 * The deterministic, model-free layer of a commit's exported JSON.
 */
interface DeterministicLayer {
  changedFiles: {
    added: string[];
    deleted: string[];
    modified: string[];
    renamed: string[];
  };
  linesAdded: number;
  linesDeleted: number;
  importantFolders: string[];
  areas: string[];
  excludedFiles: string[];
}

/**
 * The full on-disk JSON record for one commit. The model layer is null until
 * the (optional) `summarize` step fills it in.
 */
interface CommitRecord {
  commitHash: string;
  timestamp: number;
  title: string;
  author: string;
  deterministic: DeterministicLayer;
  model: null;
}

/** Sorted unique helper. */
const uniqSorted = (values: string[]): string[] => [...new Set(values)].sort();

/**
 * Builds the deterministic layer for a commit from its changed files and churn.
 * Noise files are routed to `excludedFiles` and kept out of every other list.
 * @param repoPath - Absolute repository path.
 * @param hash - Commit hash.
 */
function buildDeterministic(repoPath: string, hash: string): DeterministicLayer {
  const files = getChangedFiles(repoPath, hash);

  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];
  const renamed: string[] = [];
  const excluded: string[] = [];
  const folders: string[] = [];
  const areas: string[] = [];

  for (const file of files) {
    if (isNoise(file.path)) {
      excluded.push(file.path);
      continue;
    }
    classify(file, { added, deleted, modified, renamed });

    const dir = path.posix.dirname(file.path);
    if (dir && dir !== ".") folders.push(dir);
    areas.push(areaOf(file.path));
  }

  const churn = getChurn(repoPath, hash, isNoise);

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
 * Writes the patch and deterministic JSON for one commit.
 * @param repoPath - Absolute repository path.
 * @param outDir - The repo's commits directory.
 * @param commit - The commit to extract evidence for.
 * @param force - Overwrite an existing record.
 * @returns "extracted" when written, "skipped" when it already existed.
 */
function extractOne(
  repoPath: string,
  outDir: string,
  commit: Commit,
  force: boolean,
): "extracted" | "skipped" {
  const dir = path.join(outDir, String(commit.timestamp));
  const patchPath = path.join(dir, `${commit.hash}.patch`);
  const jsonPath = path.join(dir, `${commit.hash}.json`);

  // Append-only: never overwrite existing exports unless forced.
  if (!force && fs.existsSync(patchPath) && fs.existsSync(jsonPath)) {
    return "skipped";
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(patchPath, `${getPatch(repoPath, commit.hash)}\n`, "utf8");

  const record: CommitRecord = {
    commitHash: commit.hash,
    timestamp: commit.timestamp,
    title: commit.subject,
    author: commit.email,
    deterministic: buildDeterministic(repoPath, commit.hash),
    model: null,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  return "extracted";
}

/**
 * Extracts evidence — patch + deterministic JSON — for every commit authored by
 * the selected identities, oldest-first, into
 * `~/.workgraph/data/commits/<timestamp>/<hash>.{patch,json}`.
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
    const result = extractOne(repoPath, outDir, commit, options.force ?? false);
    if (result === "extracted") extracted += 1;
    else skipped += 1;
  }

  console.log(
    `\n✅ Done. Extracted ${extracted}, skipped ${skipped} (already present)${
      options.force ? "" : " — use --force to overwrite"
    }.`,
  );
}
