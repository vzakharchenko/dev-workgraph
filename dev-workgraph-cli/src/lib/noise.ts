// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Directory names that mark generated/vendored content anywhere in the path. */
const NOISE_DIRS = new Set(["node_modules", "dist", "build", "target", "coverage", ".next"]);

/** Exact file names that are generated lock files. */
const NOISE_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

/**
 * Returns true when a file path should be treated as generated/vendored noise
 * rather than authored evidence.
 * @param file - Repository-relative POSIX path.
 */
export function isNoise(file: string): boolean {
  const segments = file.split("/").filter(Boolean);
  if (segments.some((seg) => NOISE_DIRS.has(seg))) return true;

  const base = segments[segments.length - 1] ?? file;
  if (NOISE_FILES.has(base)) return true;
  if (base.endsWith(".min.js")) return true;
  return base.endsWith(".map");
}
