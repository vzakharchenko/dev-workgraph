// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Per-repository configuration persisted by dev-workgraph.
 */
export interface RepoConfig {
  /** Author emails the user has claimed as "their own" work. */
  selectedAuthors: string[];
  /** Max days between consecutive commits before a new work-session group starts. */
  groupThresholdDays?: number;
}

/**
 * Saved Ollama preferences so the model need not be re-chosen every run.
 */
export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
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
export function workgraphHome(): string {
  return process.env.WORKGRAPH_HOME ?? path.join(os.homedir(), ".workgraph");
}

/**
 * Absolute path to the on-disk config file (`~/.workgraph/config.json`).
 */
export function configPath(): string {
  return path.join(workgraphHome(), "config.json");
}

/**
 * Stable, human-readable identifier for a repository, derived from its
 * absolute path: `<basename>-<8-char-hash>`. The hash disambiguates repos that
 * share a basename.
 * @param repoPath - Absolute path to the repository (top-level).
 */
export function repoId(repoPath: string): string {
  const abs = path.resolve(repoPath);
  const base = path.basename(abs) || "repo";
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * Absolute path to a repository's exported-commits directory
 * (`~/.workgraph/data/repos/<repo-id>/commits`). Data is namespaced per repo so
 * commits from different repositories never mix.
 * @param repoPath - Absolute path to the repository (top-level).
 */
export function repoCommitsDir(repoPath: string): string {
  return path.join(workgraphHome(), "data", "repos", repoId(repoPath), "commits");
}

/**
 * Absolute path to a repository's work-session groups directory
 * (`~/.workgraph/data/repos/<repo-id>/groups`).
 * @param repoPath - Absolute path to the repository (top-level).
 */
export function repoGroupsDir(repoPath: string): string {
  return path.join(workgraphHome(), "data", "repos", repoId(repoPath), "groups");
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
export function saveConfig(config: WorkgraphConfig): void {
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