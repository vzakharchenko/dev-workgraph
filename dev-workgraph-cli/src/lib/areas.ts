// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Area assigned to files that live at the repository root. */
const ROOT_AREA = "(root)";

/**
 * Maps a changed file to its project area: the top-level project folder it
 * lives in (the first path segment). Files at the repository root map to
 * {@link ROOT_AREA}.
 * @param file - Repository-relative POSIX path.
 */
export function areaOf(file: string): string {
  const segments = file.split("/").filter(Boolean);
  if (segments.length <= 1) return ROOT_AREA;
  return segments[0] ?? ROOT_AREA;
}
