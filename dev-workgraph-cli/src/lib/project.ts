// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { repoProjectPath } from "./config.js";
import type { ProjectContext } from "./records.js";

/** The developer roles `init` offers, most senior first. */
export const ROLES = [
  "Principal Developer",
  "Staff Developer",
  "Senior Developer",
  "Middle Developer",
  "Junior Developer",
  "Principal Frontend Developer",
  "Staff Frontend Developer",
  "Senior Frontend Developer",
  "Middle Frontend Developer",
  "Junior Frontend Developer",
] as const;

/**
 * Loads the project context for a repo, or null when `init` has not run.
 * When a `period` is given, prefers the period's own `project.json` and falls
 * back to the repo-level context so a period pipeline still has grounding even
 * if `init:period` was skipped.
 * @param repoPath - Absolute repository path.
 * @param period - Optional review period to prefer.
 */
export function loadProjectContext(repoPath: string, period?: string): ProjectContext | null {
  const candidates = period
    ? [repoProjectPath(repoPath, period), repoProjectPath(repoPath)]
    : [repoProjectPath(repoPath)];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
