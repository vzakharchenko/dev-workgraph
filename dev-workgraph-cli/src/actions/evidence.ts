// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { areaOf } from "../lib/areas.js";
import { getRepoConfig, loadConfig, repoCommitsDir } from "../lib/config.js";
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
import { listModels, resolveBaseUrl } from "../lib/ollama.js";
import {
  buildBucketManifestPatch,
  filterPatchNoise,
  MAX_PATCH_CHARS,
  packPatchIntoParts,
  patchCommitHeader,
  peelPatchByPaths,
} from "../lib/patch-split.js";
import {
  classifyPathsByFilename,
  MAX_SPLIT_PARTS_BEFORE_PATH_FILTER,
  pathsFromPatch,
} from "../lib/path-filter.js";
import { resolvePeriodRange } from "../lib/periods.js";
import { writeRecordJson } from "../lib/record-io.js";
import type {
  CommitEvidencePartRecord,
  CommitEvidenceRecord,
  DeterministicLayer,
} from "../lib/records.js";
import { resolveModel } from "../lib/select.js";
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
  /** Ollama base URL override (used when path filter runs). */
  url?: string;
  /** Override path-filter model; else narrativeModel → reportModel → commitModel → legacy model, then prompt (not saved). */
  model?: string;
  /** Disable LLM path filter even when split would exceed {@link MAX_SPLIT_PARTS_BEFORE_PATH_FILTER}. */
  noPathFilter?: boolean;
}

function resolveEvidenceEmails(repoPath: string, emailOverride?: string[]): string[] | undefined {
  if (emailOverride && emailOverride.length > 0) {
    return emailOverride.map((e) => e.toLowerCase());
  }
  return getRepoConfig(repoPath)?.selectedAuthors;
}

function noCommitsMessage(period?: string): string {
  return period
    ? `No commits found for the selected authors in period "${period}".`
    : "No commits found for the selected authors.";
}

function extractionBanner(
  commitCount: number,
  emails: string[],
  period: string | undefined,
  outDir: string,
): string {
  const periodSuffix = period ? ` in period "${period}"` : "";
  return `Extracting evidence for ${commitCount} commit(s) by ${emails.join(", ")}${periodSuffix} → ${outDir}`;
}

function exceedsPathFilterThreshold(repoPath: string, commitHash: string): boolean {
  const patch = filterPatchNoise(getPatch(repoPath, commitHash), isNoise);
  return packPatchIntoParts(patch).length > MAX_SPLIT_PARTS_BEFORE_PATH_FILTER;
}

interface PathFilterLlm {
  baseUrl: string;
  model: string;
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
    default:
      buckets.modified.push(file.path);
  }
}

/**
 * Append-only: true when all split part files exist on disk.
 */
function splitPartsComplete(dir: string, hash: string, partCount: number): boolean {
  for (let part = 1; part <= partCount; part += 1) {
    const partJson = path.join(dir, `${hash}.part${part}.json`);
    const partPatch = path.join(dir, `${hash}.part${part}.patch`);
    if (!fs.existsSync(partJson) || !fs.existsSync(partPatch)) return false;
  }
  return true;
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
    return partCount >= 1 && splitPartsComplete(dir, hash, partCount);
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

function writeAuthoredPart(input: {
  repoPath: string;
  dir: string;
  commit: Commit;
  partNum: number;
  partCount: number;
  part: { patch: string; paths: string[]; patchTruncated: boolean };
}): void {
  const { repoPath, dir, commit, partNum, partCount, part } = input;
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

function writeBucketPart(input: {
  repoPath: string;
  dir: string;
  commit: Commit;
  partNum: number;
  partCount: number;
  bucketPaths: string[];
  manifestPatch: string;
}): void {
  const scope = new Set(input.bucketPaths);
  const partRecord: CommitEvidencePartRecord = {
    commitHash: input.commit.hash,
    timestamp: input.commit.timestamp,
    title: input.commit.subject,
    author: input.commit.email,
    part: input.partNum,
    partCount: input.partCount,
    patchTruncated: false,
    isBinaryOrAutogenerated: true,
    deterministic: buildDeterministic(input.repoPath, input.commit.hash, scope),
  };
  fs.writeFileSync(
    path.join(input.dir, `${input.commit.hash}.part${input.partNum}.patch`),
    input.manifestPatch,
    "utf8",
  );
  writeRecordJson(
    path.join(input.dir, `${input.commit.hash}.part${input.partNum}.json`),
    partRecord,
  );
}

interface PathFilterPeelStats {
  totalFiles: number;
  authoredFiles: number;
  peeledFiles: number;
  initialPartCount: number;
}

interface PathFilterPeelResult {
  authoredPatch: string;
  bucketPaths: string[];
  pathFilterApplied: boolean;
  peelStats?: PathFilterPeelStats;
}

async function maybePeelBinaryAndGenerated(input: {
  patch: string;
  llm: PathFilterLlm | null;
  noPathFilter?: boolean;
  commitShort: string;
}): Promise<PathFilterPeelResult> {
  const initialPartCount = packPatchIntoParts(input.patch).length;
  if (input.noPathFilter || !input.llm || initialPartCount <= MAX_SPLIT_PARTS_BEFORE_PATH_FILTER) {
    return { authoredPatch: input.patch, bucketPaths: [], pathFilterApplied: false };
  }

  console.log(
    `  ${input.commitShort} split → ${initialPartCount} parts (>${MAX_SPLIT_PARTS_BEFORE_PATH_FILTER}); using LLM to detect binary/autogenerated paths…`,
  );

  const paths = pathsFromPatch(input.patch);
  const totalFiles = paths.length;
  const classified = await classifyPathsByFilename({
    baseUrl: input.llm.baseUrl,
    model: input.llm.model,
    paths,
  });
  const exclude = new Set([...classified.likelyBinary, ...classified.likelyGenerated]);
  if (exclude.size === 0) {
    console.log(
      `  ${input.commitShort} LLM found no binary/autogenerated paths to peel (${totalFiles} files, still ${initialPartCount} parts)`,
    );
    return { authoredPatch: input.patch, bucketPaths: [], pathFilterApplied: false };
  }

  const { authoredPatch, bucketPaths } = peelPatchByPaths(input.patch, exclude);
  if (bucketPaths.length === 0) {
    return { authoredPatch: input.patch, bucketPaths: [], pathFilterApplied: false };
  }

  const authoredFiles = pathsFromPatch(authoredPatch).length;
  return {
    authoredPatch,
    bucketPaths,
    pathFilterApplied: true,
    peelStats: {
      totalFiles,
      authoredFiles,
      peeledFiles: bucketPaths.length,
      initialPartCount,
    },
  };
}

async function writeSplitCommit(
  repoPath: string,
  dir: string,
  commit: Commit,
  patch: string,
  llm: PathFilterLlm | null,
  noPathFilter?: boolean,
): Promise<void> {
  const short = commit.hash.slice(0, 8);
  const peeled = await maybePeelBinaryAndGenerated({
    patch,
    llm,
    noPathFilter,
    commitShort: short,
  });
  const parts = packPatchIntoParts(peeled.authoredPatch);
  const bucketPartNum = peeled.pathFilterApplied ? parts.length + 1 : parts.length;
  const partCount = bucketPartNum;
  const jsonPath = path.join(dir, `${commit.hash}.json`);

  const manifest: CommitEvidenceRecord = {
    commitHash: commit.hash,
    timestamp: commit.timestamp,
    title: commit.subject,
    author: commit.email,
    split: true,
    partCount,
    pathFilterApplied: peeled.pathFilterApplied,
    deterministic: buildDeterministic(repoPath, commit.hash),
  };
  writeRecordJson(jsonPath, manifest);

  for (const [index, part] of parts.entries()) {
    writeAuthoredPart({
      repoPath,
      dir,
      commit,
      partNum: index + 1,
      partCount,
      part,
    });
  }

  if (peeled.pathFilterApplied && peeled.bucketPaths.length > 0) {
    const manifestPatch = buildBucketManifestPatch(patchCommitHeader(patch), peeled.bucketPaths);
    writeBucketPart({
      repoPath,
      dir,
      commit,
      partNum: bucketPartNum,
      partCount,
      bucketPaths: peeled.bucketPaths,
      manifestPatch,
    });
    const s = peeled.peelStats;
    const authoredPartCount = parts.length;
    if (s) {
      console.log(
        `  ${short} of ${s.totalFiles} files: ${s.peeledFiles} autogenerated/binary, ${s.authoredFiles} authored → ${authoredPartCount} part(s) + 1 autogenerated bucket`,
      );
    } else {
      console.log(
        `  ${short} peeled ${peeled.bucketPaths.length} autogenerated/binary path(s) → ${authoredPartCount} part(s) + 1 autogenerated bucket`,
      );
    }
  }
}

async function assertModelInstalled(baseUrl: string, model: string): Promise<void> {
  const available = await listModels(baseUrl);
  if (!available.includes(model)) {
    throw new Error(`Model "${model}" not found on Ollama. Available: ${available.join(", ")}`);
  }
}

async function resolvePathFilterLlm(
  options: EvidenceOptions,
  llm: PathFilterLlm | undefined,
): Promise<PathFilterLlm | null> {
  if (options.noPathFilter) return null;
  if (llm) return llm;

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const preset =
    options.model ??
    savedOllama?.narrativeModel ??
    savedOllama?.reportModel ??
    savedOllama?.commitModel ??
    savedOllama?.model;

  if (preset) {
    await assertModelInstalled(baseUrl, preset);
    return { baseUrl, model: preset };
  }

  const model = await resolveModel(baseUrl, undefined, {
    message: "Which Ollama model should classify paths for large split commits?",
  });
  return { baseUrl, model };
}

/**
 * Writes the patch and deterministic JSON for one commit.
 * @param repoPath - Absolute repository path.
 * @param outDir - The repo's commits directory.
 * @param commit - The commit to extract evidence for.
 * @param llm - Shared path-filter LLM context (resolved lazily).
 * @param options - Evidence command options.
 * @returns "extracted" when written, "skipped" when it already existed.
 */
async function extractOne(
  repoPath: string,
  outDir: string,
  commit: Commit,
  llm: PathFilterLlm | null,
  options: EvidenceOptions,
): Promise<"extracted" | "skipped"> {
  const dir = path.join(outDir, String(commit.timestamp));

  if (isFullyExtracted(dir, commit.hash)) {
    return "skipped";
  }

  fs.mkdirSync(dir, { recursive: true });
  const patch = filterPatchNoise(getPatch(repoPath, commit.hash), isNoise);

  if (patch.length <= MAX_PATCH_CHARS) {
    writeSmallCommit(repoPath, dir, commit, patch);
  } else {
    await writeSplitCommit(repoPath, dir, commit, patch, llm, options.noPathFilter);
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
  const emails = resolveEvidenceEmails(repoPath, options.email);

  if (!emails || emails.length === 0) {
    console.error("✖ No authors selected. Run `dev-workgraph authors` first, or pass --email.");
    process.exitCode = 1;
    return;
  }

  const range = options.period ? resolvePeriodRange(repoPath, options.period) : undefined;
  const commits = getCommits(repoPath, emails, range);
  if (commits.length === 0) {
    console.log(noCommitsMessage(options.period));
    return;
  }

  const outDir = repoCommitsDir(repoPath, options.period);
  console.log(extractionBanner(commits.length, emails, options.period, outDir));

  let extracted = 0;
  let skipped = 0;
  let pathFilterLlm: PathFilterLlm | undefined;

  for (const commit of commits) {
    const preSplit = !options.noPathFilter && exceedsPathFilterThreshold(repoPath, commit.hash);

    if (preSplit && !pathFilterLlm) {
      pathFilterLlm = (await resolvePathFilterLlm(options, undefined)) ?? undefined;
    }

    const result = await extractOne(repoPath, outDir, commit, pathFilterLlm ?? null, options);
    if (result === "extracted") extracted += 1;
    else skipped += 1;
  }

  console.log(`\n✅ Done. Extracted ${extracted}, skipped ${skipped} (already present).`);
}
