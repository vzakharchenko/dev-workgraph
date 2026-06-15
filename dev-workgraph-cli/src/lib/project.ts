// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { repoProjectPath } from "./config.js";
import type { ProjectContext } from "./records.js";

/** The developer roles `init` offers, most senior first. */
export const ROLES = [
  "Principal Developer",
  "Staff Developer",
  "Senior Developer",
  "Junior Developer",
] as const;

/**
 * Loads the project context for a repo, or null when `init` has not run.
 * @param repoPath - Absolute repository path.
 */
export function loadProjectContext(repoPath: string): ProjectContext | null {
  const file = repoProjectPath(repoPath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
  } catch {
    return null;
  }
}
