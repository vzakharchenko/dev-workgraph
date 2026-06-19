// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A named review window. Dates are ISO `YYYY-MM-DD`; the range is half-open
 * `[from, to)` (from inclusive, to exclusive) so adjacent periods never
 * double-count a commit on the boundary.
 */
export interface Period {
  /** Inclusive start date, ISO `YYYY-MM-DD`. */
  from: string;
  /** Exclusive end date, ISO `YYYY-MM-DD`. */
  to: string;
}

/**
 * Per-repository configuration persisted by dev-workgraph.
 */
export interface RepoConfig {
  /** Author emails the user has claimed as "their own" work. */
  selectedAuthors: string[];
  /** The developer's role on this project (captured by `init`). */
  role?: string;
  /** Max days between consecutive commits before a new work-session group starts. */
  groupThresholdDays?: number;
  /** Max commits per work-session group (0 = unlimited). */
  groupMaxCommits?: number;
  /** Named review windows, keyed by a human label (e.g. "2022", "2022-H1"). */
  periods?: Record<string, Period>;
}

/**
 * Saved Ollama preferences so the model need not be re-chosen every run.
 */
export interface OllamaConfig {
  baseUrl?: string;
  /** Legacy/general model; used as a fallback seed for the role-specific slots. */
  model?: string;
  /** Model for commit-level work: `summarize` and `commit-group`. */
  commitModel?: string;
  /** Model for report-level work: `init` and `report`. */
  reportModel?: string;
  /** Model for narrative work: `prepare` and `final`. */
  narrativeModel?: string;
}

/**
 * Root configuration object stored on disk. Keyed by absolute repo path.
 */
export interface WorkgraphConfig {
  repos: Record<string, RepoConfig>;
  ollama?: OllamaConfig;
}

const EMPTY_CONFIG: WorkgraphConfig = { repos: {} };

/**
 * Resolves the dev-workgraph home directory.
 * Honors `WORKGRAPH_HOME`, then defaults to `~/.workgraph`.
 */
function workgraphHome(): string {
  return process.env.WORKGRAPH_HOME ?? path.join(os.homedir(), ".workgraph");
}

/**
 * Absolute path to the on-disk config file (`~/.workgraph/config.json`).
 */
function configPath(): string {
  return path.join(workgraphHome(), "config.json");
}

/**
 * Stable, human-readable identifier for a repository, derived from its
 * absolute path: `<basename>-<8-char-hash>`. The hash disambiguates repos that
 * share a basename.
 * @param repoPath - Absolute path to the repository (top-level).
 */
function repoId(repoPath: string): string {
  const abs = path.resolve(repoPath);
  const base = path.basename(abs) || "repo";
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * Root of a repository's data namespace, optionally scoped to a review period.
 * Without a period: `~/.workgraph/data/repos/<repo-id>`. With one, the whole
 * sub-tree is nested under `periods/<period>` so a period review never mixes
 * with the repo's all-time data — and a period label can never collide with a
 * sibling subdir name like `commits`.
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional period label to scope under.
 */
function repoRoot(repoPath: string, period?: string): string {
  const base = path.join(workgraphHome(), "data", "repos", repoId(repoPath));
  return period ? path.join(base, "periods", period) : base;
}

/**
 * Absolute path to a repository's exported-commits directory
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/commits`). Data is
 * namespaced per repo (and per period) so commits never mix.
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoCommitsDir(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "commits");
}

/**
 * Absolute path to a repository's work-session groups directory
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/groups`).
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoGroupsDir(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "groups");
}

/**
 * Absolute path to a repository's cumulative reports directory
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/reports`).
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoReportsDir(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "reports");
}

/**
 * Absolute path to a repository's prepared-narratives directory
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/prepared`), written by
 * `prepare`.
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoPreparedDir(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "prepared");
}

/**
 * Absolute path to a repository's finish directory
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/finish`), written by
 * `final`: a copy of the result markdown plus a JSON record that links back to
 * the source prepared file.
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoFinishDir(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "finish");
}

/**
 * Absolute path to a repository's project context file
 * (`~/.workgraph/data/repos/<repo-id>[/periods/<period>]/project.json`), written
 * by `init`.
 * @param repoPath - Absolute path to the repository (top-level).
 * @param period - Optional review period to scope under.
 */
export function repoProjectPath(repoPath: string, period?: string): string {
  return path.join(repoRoot(repoPath, period), "project.json");
}

/**
 * Absolute path to a repository's whole data directory
 * (`~/.workgraph/data/repos/<repo-id>`). Its basename is the repo id, and its
 * parent is the shared repos root — used by `export`/`import` bundling.
 * @param repoPath - Absolute path to the repository (top-level).
 */
export function repoDataDir(repoPath: string): string {
  return path.join(workgraphHome(), "data", "repos", repoId(repoPath));
}

/**
 * Reads the config file, returning an empty config when none exists or
 * the file is unreadable/corrupt.
 */
export function loadConfig(): WorkgraphConfig {
  const file = configPath();
  if (!fs.existsSync(file)) return structuredClone(EMPTY_CONFIG);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WorkgraphConfig;
    return { repos: parsed.repos ?? {}, ollama: parsed.ollama };
  } catch {
    return structuredClone(EMPTY_CONFIG);
  }
}

/**
 * Writes the config back to disk, creating the home directory if needed.
 * @param config - The full configuration object to persist.
 */
function saveConfig(config: WorkgraphConfig): void {
  const home = workgraphHome();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Persists Ollama preferences, merging with any existing config.
 * @param ollama - The Ollama settings to store.
 */
export function setOllamaConfig(ollama: OllamaConfig): void {
  const config = loadConfig();
  config.ollama = { ...config.ollama, ...ollama };
  saveConfig(config);
}

/**
 * Returns the stored config for a single repo, or undefined when unseen.
 * @param repoPath - Absolute path to the repository.
 */
export function getRepoConfig(repoPath: string): RepoConfig | undefined {
  return loadConfig().repos[repoPath];
}

/**
 * Merges and persists config for a single repo, preserving any fields not
 * provided in `repoConfig`.
 * @param repoPath - Absolute path to the repository.
 * @param repoConfig - Partial repo config to merge in.
 */
export function setRepoConfig(repoPath: string, repoConfig: Partial<RepoConfig>): void {
  const config = loadConfig();
  const existing = config.repos[repoPath] ?? { selectedAuthors: [] };
  config.repos[repoPath] = { ...existing, ...repoConfig };
  saveConfig(config);
}

/**
 * Returns a named review period for a repo, or undefined when it is not defined.
 * @param repoPath - Absolute path to the repository.
 * @param id - The period label.
 */
export function getPeriod(repoPath: string, id: string): Period | undefined {
  return getRepoConfig(repoPath)?.periods?.[id];
}

/**
 * Defines or updates a named review period for a repo (merging into any
 * existing `periods` map).
 * @param repoPath - Absolute path to the repository.
 * @param id - The period label (used as a directory name).
 * @param period - The from/to window to store.
 */
export function setPeriod(repoPath: string, id: string, period: Period): void {
  const existing = getRepoConfig(repoPath)?.periods ?? {};
  setRepoConfig(repoPath, { periods: { ...existing, [id]: period } });
}
