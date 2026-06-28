// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * An author aggregated from the repository's commit history.
 */
export interface Author {
  /** Author email (the identity key). */
  email: string;
  /** Most frequently seen display name for this email. */
  name: string;
  /** Number of commits authored by this email across all branches. */
  commits: number;
}

/**
 * Runs a git command in the given repo and returns trimmed stdout.
 * Throws if git exits non-zero.
 * @param repoPath - Absolute path to the repository.
 * @param args - Git arguments (without the leading `git`).
 */
function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Resolves and validates a repository path, returning its top-level directory.
 * @param repoPath - User-provided path (may be relative).
 * @throws When the path is not inside a Git working tree.
 */
export function resolveRepo(repoPath: string): string {
  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Path does not exist: ${abs}`);
  }
  try {
    return git(abs, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(`Not a Git repository: ${abs}`);
  }
}

/**
 * Returns the configured author email for the repo, or undefined when unset.
 * Used to pre-select the user's own identity in interactive prompts.
 * @param repoPath - Absolute path to the repository.
 */
export function currentUserEmail(repoPath: string): string | undefined {
  try {
    const email = git(repoPath, ["config", "user.email"]);
    return email || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A commit selected from history, with the metadata needed for export.
 */
export interface Commit {
  /** Full 40-char commit hash. */
  hash: string;
  /** Author Unix timestamp (seconds) — when the work was authored. */
  timestamp: number;
  /** Author email (lowercased). */
  email: string;
  /** Author display name. */
  name: string;
  /** Commit subject line. */
  subject: string;
}

/** A single changed file from `--name-status` output. */
export interface ChangedFile {
  /** Status letter: A, M, D, R, C, T. */
  status: string;
  /** Final path of the file (new path for renames/copies). */
  path: string;
  /** Original path for renames/copies, when applicable. */
  oldPath?: string;
}

const UNIT = "\x1f";

/** An optional author-timestamp window (epoch seconds), half-open `[from, to)`. */
export interface CommitRange {
  /** Inclusive lower bound; commits before this are dropped. */
  from?: number;
  /** Exclusive upper bound; commits at or after this are dropped. */
  to?: number;
}

/**
 * Returns all non-merge commits authored by any of the given emails, across
 * every branch, sorted oldest-first. An optional author-timestamp `range`
 * (half-open `[from, to)`) restricts the result to a review period.
 * @param repoPath - Absolute path to the repository.
 * @param emails - Author emails to keep (case-insensitive).
 * @param range - Optional `[from, to)` author-timestamp window (epoch seconds).
 */
export function getCommits(repoPath: string, emails: string[], range?: CommitRange): Commit[] {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const fmt = ["%H", "%at", "%ae", "%an", "%s"].join(UNIT);
  const raw = git(repoPath, ["log", "--all", "--no-merges", `--format=${fmt}%x00`]);
  if (!raw) return [];

  const commits: Commit[] = [];
  for (const row of raw.split("\0")) {
    const line = row.replace(/^\n/, "");
    if (!line.trim()) continue;
    const [hash, at, email, name, subject = ""] = line.split(UNIT);
    if (!hash || !email) continue;
    const lowered = email.trim().toLowerCase();
    if (!wanted.has(lowered)) continue;
    const timestamp = Number.parseInt(at ?? "0", 10);
    if (range?.from !== undefined && timestamp < range.from) continue;
    if (range?.to !== undefined && timestamp >= range.to) continue;
    commits.push({
      hash,
      timestamp,
      email: lowered,
      name: (name ?? "").trim(),
      subject: subject.trim(),
    });
  }

  return commits.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Produces the human-readable patch for a commit using the reproducible
 * `git show --format=fuller --find-renames` command.
 * @param repoPath - Absolute path to the repository.
 * @param hash - Commit hash.
 */
export function getPatch(repoPath: string, hash: string): string {
  return git(repoPath, ["show", "--format=fuller", "--find-renames", hash]);
}

/**
 * Returns the changed files for a commit with their status, resolving renames.
 * @param repoPath - Absolute path to the repository.
 * @param hash - Commit hash.
 */
export function getChangedFiles(repoPath: string, hash: string): ChangedFile[] {
  const raw = git(repoPath, ["show", "--format=", "--name-status", "--find-renames", hash]);
  const files: ChangedFile[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const status = code.charAt(0);
    if (status === "R" || status === "C") {
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath && newPath) files.push({ status, path: newPath, oldPath });
    } else {
      const filePath = parts[1];
      if (filePath) files.push({ status, path: filePath });
    }
  }
  return files;
}

/**
 * Returns total lines added/deleted for a commit, excluding files matched by
 * the provided noise predicate. Binary files contribute zero.
 * @param repoPath - Absolute path to the repository.
 * @param hash - Commit hash.
 * @param isNoise - Predicate marking a path as generated/vendored noise.
 */
export function getChurn(
  repoPath: string,
  hash: string,
  isNoise: (file: string) => boolean,
): { added: number; deleted: number } {
  const raw = git(repoPath, ["show", "--format=", "--numstat", "--find-renames", hash]);
  let added = 0;
  let deleted = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [addStr, delStr, ...rest] = line.split("\t");
    if (addStr === "-" || delStr === "-") continue; // binary
    const file = normalizeNumstatPath(rest.join("\t"));
    if (!file || isNoise(file)) continue;
    added += Number.parseInt(addStr ?? "0", 10) || 0;
    deleted += Number.parseInt(delStr ?? "0", 10) || 0;
  }
  return { added, deleted };
}

/**
 * Replaces git rename brace segments like `{old => new}` with the destination path.
 */
function replaceBraceRenameSegments(pathValue: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < pathValue.length) {
    const open = pathValue.indexOf("{", cursor);
    if (open === -1) {
      result += pathValue.slice(cursor);
      break;
    }
    result += pathValue.slice(cursor, open);
    const close = pathValue.indexOf("}", open + 1);
    if (close === -1) {
      result += pathValue.slice(open);
      break;
    }
    const inner = pathValue.slice(open + 1, close);
    const arrow = inner.indexOf("=>");
    result += arrow === -1 ? pathValue.slice(open, close + 1) : inner.slice(arrow + 2).trim();
    cursor = close + 1;
  }
  return result.replaceAll("//", "/");
}

/**
 * Normalizes the path field from `--numstat`, which encodes renames as
 * `old => new` or `dir/{old => new}/file`, into the final path.
 * @param raw - The raw path field.
 */
function normalizeNumstatPath(raw: string): string {
  let p = raw.trim();
  if (p.includes("{") && p.includes("=>")) {
    p = replaceBraceRenameSegments(p);
  } else if (p.includes("=>")) {
    p = p.split("=>")[1]?.trim() ?? p;
  }
  return p.trim();
}

/**
 * Aggregates all commit authors across every branch, sorted by commit count
 * (descending). Names are de-duplicated per email, keeping the most common one.
 * @param repoPath - Absolute path to the repository.
 */
export function getAuthors(repoPath: string): Author[] {
  // %ae = author email, %an = author name; tab-separated, NUL-delimited rows.
  const raw = git(repoPath, ["log", "--all", "--no-merges", "--format=%ae%x09%an%x00"]);
  if (!raw) return [];

  const byEmail = new Map<string, { commits: number; names: Map<string, number> }>();

  for (const row of raw.split("\0")) {
    const line = row.trim();
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const email = line.slice(0, tab).trim().toLowerCase();
    const name = line.slice(tab + 1).trim();
    if (!email) continue;

    const entry = byEmail.get(email) ?? { commits: 0, names: new Map() };
    entry.commits += 1;
    entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
    byEmail.set(email, entry);
  }

  const authors: Author[] = [...byEmail.entries()].map(([email, entry]) => {
    const name = [...entry.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? email;
    return { email, name, commits: entry.commits };
  });

  return authors.sort((a, b) => b.commits - a.commits);
}
