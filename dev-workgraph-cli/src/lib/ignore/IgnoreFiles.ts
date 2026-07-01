// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

/** Ignore rules for one language or ecosystem. */
export interface IgnoreFiles {
  /** Human-readable profile name (for logging / future CLI). */
  name(): string;
  /** Directory segment patterns — matched against each path component. */
  dirs(): string[];
  /** File-name patterns — matched against the basename only. */
  files(): string[];
}
