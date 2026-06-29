// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoDataDir, setRepoConfig } from "../lib/config.js";
import type { BundleManifest } from "./export.js";

/**
 * Options for the `import` command (restore a bundle made by `export`).
 */
export interface ImportOptions {
  /** Path to the `.tar.gz` produced by `export`. */
  tarball: string;
  /** Re-target the data under a different repo path (default: the manifest's path). */
  repo?: string;
}

/**
 * Restores a workgraph bundle: unpacks the data directory under the target
 * repo's namespace and adds/updates the repo's `config.json` entry.
 * @param options - Resolved command options.
 */
export async function importRepo(options: ImportOptions): Promise<void> {
  const tarball = path.resolve(options.tarball);
  if (!fs.existsSync(tarball)) {
    console.error(`✖ Bundle not found: ${tarball}`);
    process.exitCode = 1;
    return;
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-import-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", staging], { stdio: "ignore" });

    const manifestPath = path.join(staging, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.error("✖ Bundle has no manifest.json — not a workgraph export.");
      process.exitCode = 1;
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BundleManifest;

    const srcDataDir = path.join(staging, manifest.repoId);
    if (!fs.existsSync(srcDataDir)) {
      console.error(`✖ Bundle is missing its data directory (${manifest.repoId}).`);
      process.exitCode = 1;
      return;
    }

    // Target: the manifest's original repo path, or a re-target override.
    const targetPath = options.repo ? path.resolve(options.repo) : manifest.repoPath;
    const destDataDir = repoDataDir(targetPath);

    if (fs.existsSync(destDataDir)) {
      console.error(
        `✖ Data already exists for this repo (${destDataDir}). Remove it manually before importing.`,
      );
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(path.dirname(destDataDir), { recursive: true });
    fs.cpSync(srcDataDir, destDataDir, { recursive: true });

    // Add or update the repo's config entry (merges into any existing one).
    if (manifest.config) setRepoConfig(targetPath, manifest.config);

    console.log(`✅ Imported bundle into ${destDataDir}`);
    console.log(`   repo: ${targetPath}`);
    console.log(`   config entry: ${manifest.config ? "added/updated" : "none in bundle"}`);
    if (options.repo && targetPath !== manifest.repoPath) {
      console.log(`   re-targeted from ${manifest.repoPath}`);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
