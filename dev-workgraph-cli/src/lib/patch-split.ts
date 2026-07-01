// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Maximum characters stored per evidence patch file (`.patch` or `.partN.patch`). */
export const MAX_PATCH_CHARS = 24_000;

export const PATCH_TRUNCATED_MARKER = "\n[...patch truncated at 24000 chars...]\n";

/** One packed patch slice written as `<hash>.partN.patch`. */
export interface PatchPart {
  patch: string;
  paths: string[];
  patchTruncated: boolean;
}

interface FileHunk {
  text: string;
  paths: string[];
}

function isDiffGitLine(line: string | undefined): line is string {
  return line?.startsWith("diff --git ") ?? false;
}

/**
 * Splits a `git show` patch into a commit header and per-file diff hunks.
 * @param patch - Full patch text from `git show`.
 */
export function splitPatchByFile(patch: string): { header: string; hunks: FileHunk[] } {
  const lines = patch.split("\n");
  const hunks: FileHunk[] = [];
  let i = 0;

  while (i < lines.length && !isDiffGitLine(lines[i])) {
    i += 1;
  }
  const header = lines.slice(0, i).join("\n");
  if (i < lines.length && header.length > 0) {
    // Keep the blank line before the first diff when present.
  }

  while (i < lines.length) {
    const diffLine = lines[i];
    if (!isDiffGitLine(diffLine)) {
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < lines.length && !isDiffGitLine(lines[i])) {
      i += 1;
    }
    const text = `${lines.slice(start, i).join("\n")}\n`;
    const paths = pathsFromDiffGitLine(diffLine);
    hunks.push({ text, paths });
  }

  return { header: header.length > 0 ? `${header}\n` : "", hunks };
}

/**
 * Removes per-file diff hunks whose paths are all noise (per {@link isNoise}).
 * Commit metadata before the first `diff --git` line is preserved.
 * @param patch - Full patch text from `git show`.
 * @param isNoise - Predicate marking a path as generated/vendored noise.
 */
export function filterPatchNoise(patch: string, isNoise: (path: string) => boolean): string {
  const { header, hunks } = splitPatchByFile(patch);
  const kept = hunks.filter((h) => !hunkIsNoise(h, isNoise));
  if (kept.length === 0) return header;
  return `${header}${kept.map((h) => h.text).join("")}`;
}

function hunkIsNoise(hunk: FileHunk, isNoise: (path: string) => boolean): boolean {
  return hunk.paths.length > 0 && hunk.paths.every(isNoise);
}

/**
 * True when a patch has no per-file diff hunks (empty, whitespace-only, or commit header only).
 * @param patch - Patch text from evidence export (possibly noise-filtered).
 */
export function isEmptySummarizePatch(patch: string): boolean {
  if (!patch.trim()) return true;
  return !/^diff --git /m.test(patch);
}

/**
 * Packs a patch into ≤ {@link MAX_PATCH_CHARS} slices, splitting on file boundaries.
 * Oversized single-file hunks are truncated in their own part.
 * @param patch - Full patch text from `git show`.
 */
export function packPatchIntoParts(patch: string): PatchPart[] {
  if (patch.length <= MAX_PATCH_CHARS) {
    return [{ patch, paths: collectPaths(patch), patchTruncated: false }];
  }

  const { header, hunks } = splitPatchByFile(patch);
  if (hunks.length === 0) {
    return [
      {
        patch: truncatePatch(patch, MAX_PATCH_CHARS),
        paths: [],
        patchTruncated: patch.length > MAX_PATCH_CHARS,
      },
    ];
  }

  const parts: PatchPart[] = [];
  let batch: FileHunk[] = [];
  let batchSize = 0;
  let includeHeader = true;

  const flushBatch = (): void => {
    if (batch.length === 0) return;
    const body = batch.map((h) => h.text).join("");
    const paths = uniqPaths(batch.flatMap((h) => h.paths));
    const prefix = includeHeader ? header : "";
    parts.push({ patch: `${prefix}${body}`, paths, patchTruncated: false });
    includeHeader = false;
    batch = [];
    batchSize = 0;
  };

  const emitOversized = (hunk: FileHunk): void => {
    flushBatch();
    const prefix = includeHeader ? header : "";
    const budget = Math.max(0, MAX_PATCH_CHARS - prefix.length);
    const body = truncatePatch(hunk.text, budget);
    parts.push({
      patch: `${prefix}${body}`,
      paths: hunk.paths,
      patchTruncated: hunk.text.length > budget,
    });
    includeHeader = false;
  };

  for (const hunk of hunks) {
    const prefixLen = includeHeader && batch.length === 0 ? header.length : 0;
    if (prefixLen + hunk.text.length > MAX_PATCH_CHARS) {
      emitOversized(hunk);
      continue;
    }
    if (prefixLen + batchSize + hunk.text.length > MAX_PATCH_CHARS) {
      flushBatch();
    }
    if ((includeHeader ? header.length : 0) + hunk.text.length > MAX_PATCH_CHARS) {
      emitOversized(hunk);
      continue;
    }
    batch.push(hunk);
    batchSize += hunk.text.length;
  }

  flushBatch();
  return parts;
}

/**
 * Truncates patch text to at most `maxChars`, appending {@link PATCH_TRUNCATED_MARKER}.
 * @param patch - Patch body to truncate.
 * @param maxChars - Maximum stored characters including the marker when truncated.
 */
export function truncatePatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) return patch;
  const markerBudget = PATCH_TRUNCATED_MARKER.length;
  const sliceEnd = Math.max(0, maxChars - markerBudget);
  return `${patch.slice(0, sliceEnd)}${PATCH_TRUNCATED_MARKER}`;
}

function collectPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      paths.push(...pathsFromDiffGitLine(line));
    }
  }
  return uniqPaths(paths);
}

function uniqPaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Extracts repository-relative paths from a `diff --git a/… b/…` line.
 * @param line - First line of a file hunk.
 */
export function pathsFromDiffGitLine(line: string): string[] {
  const rest = line.slice("diff --git ".length);
  const tab = rest.indexOf("\t");
  const pair = tab === -1 ? rest : rest.slice(0, tab);
  const space = pair.indexOf(" ");
  if (space === -1) return [];
  const aPath = unquoteGitPath(pair.slice(0, space).replace(/^a\//, ""));
  const bPath = unquoteGitPath(pair.slice(space + 1).replace(/^b\//, ""));
  return aPath === bPath ? [bPath] : uniqPaths([aPath, bPath]);
}

function unquoteGitPath(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  return raw;
}
