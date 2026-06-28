// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Locale-aware comparator for reliable alphabetical ordering (Sonar S2871). */
export function compareLocale(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Sorted unique strings using locale-aware ordering. */
export function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareLocale);
}
