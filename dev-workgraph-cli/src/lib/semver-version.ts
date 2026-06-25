// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/**
 * Encodes `major.minor.patch` as a single integer for JSON schema versioning.
 * Example: `1.0.0` → `1000000`, `1.2.3` → `1002003`.
 */
export function encodeSemver(semver: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(semver.trim());
  if (!match) {
    throw new Error(`invalid semver: ${semver}`);
  }
  const major = Number.parseInt(match[1] ?? "0", 10);
  const minor = Number.parseInt(match[2] ?? "0", 10);
  const patch = Number.parseInt(match[3] ?? "0", 10);
  return major * 1_000_000 + minor * 1_000 + patch;
}
