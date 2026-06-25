// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoConfig, type RepoConfig, repoDataDir } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { VERSION } from "../lib/version.js";

/**
 * Options for the `export` command (bundle a repo's workgraph data).
 */
export interface ExportOptions {
  /** Path to the repository whose workgraph data to bundle. */
  repo: string;
  /** Output `.tar.gz` path (default: ./<repo-id>.workgraph.tar.gz). */
  output?: string;
}

/**
 * Bundle manifest written at the archive root, so `import` can restore both the
 * data directory and the repo's config entry (which lives outside the data dir).
 */
export interface BundleManifest {
  /** Encoded package semver of the CLI that produced the bundle. */
  schemaVersion: number;
  /** Data-directory name (`<basename>-<hash>`). */
  repoId: string;
  /** Absolute repo path on the exporting machine. */
  repoPath: string;
  exportedAt: string;
  /** The repo's entry from `config.json` → `repos[repoPath]` (may be undefined). */
  config?: RepoConfig;
}

/**
 * Packages a repository's workgraph data (`~/.workgraph/data/repos/<repo-id>`)
 * plus its config entry into a portable `.tar.gz`.
 * @param options - Resolved command options.
 */
export async function exportRepo(options: ExportOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const dataDir = repoDataDir(repoPath);
  if (!fs.existsSync(dataDir)) {
    console.error(`✖ No workgraph data for ${repoPath} (${dataDir}). Run the pipeline first.`);
    process.exitCode = 1;
    return;
  }

  const reposRoot = path.dirname(dataDir);
  const id = path.basename(dataDir);
  const manifest: BundleManifest = {
    schemaVersion: VERSION,
    repoId: id,
    repoPath,
    exportedAt: new Date().toISOString(),
    config: getRepoConfig(repoPath),
  };

  const outPath = path.resolve(options.output ?? `${id}.workgraph.tar.gz`);

  // Stage the manifest in a temp dir, then tar both the data dir and the manifest
  // (two `-C` members) so the archive carries everything `import` needs.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-export-"));
  try {
    fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync("tar", ["-czf", outPath, "-C", reposRoot, id, "-C", staging, "manifest.json"], {
      stdio: "ignore",
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  console.log(`✅ Exported ${id} → ${outPath}`);
  console.log(`   data dir: ${dataDir}`);
  console.log(`   config entry: ${manifest.config ? "included" : "none saved"}`);
}
