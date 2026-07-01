// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { IgnoreFiles } from "./ignore/IgnoreFiles.js";
import { ignoreFiles } from "./ignore.js";

/** Turn a simple glob (`*` only) into a RegExp anchored to the full string. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function compileMatchers(profiles: IgnoreFiles[]): {
  dirMatchers: RegExp[];
  fileMatchers: RegExp[];
} {
  const dirMatchers: RegExp[] = [];
  const fileMatchers: RegExp[] = [];
  for (const profile of profiles) {
    for (const dir of profile.dirs()) {
      dirMatchers.push(globToRegExp(dir));
    }
    for (const file of profile.files()) {
      fileMatchers.push(globToRegExp(file));
    }
  }
  return { dirMatchers, fileMatchers };
}

const { dirMatchers, fileMatchers } = compileMatchers(ignoreFiles);

/**
 * Returns true when a file path should be treated as generated/vendored noise
 * rather than authored evidence.
 * @param file - Repository-relative POSIX path.
 */
export function isNoise(file: string): boolean {
  const segments = file.split("/").filter(Boolean);
  if (segments.some((seg) => dirMatchers.some((re) => re.test(seg)))) return true;

  const base = segments.at(-1) ?? file;
  return fileMatchers.some((re) => re.test(base));
}
