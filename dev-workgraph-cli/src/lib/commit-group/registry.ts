// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { dayGapStrategy } from "./day-gap-strategy.js";
import type { CommitGroupStrategy } from "./types.js";

/** Registered commit-group strategies — append custom kinds here. */
export const COMMIT_GROUP_STRATEGIES: readonly CommitGroupStrategy[] = [dayGapStrategy];

const BY_ID = new Map(COMMIT_GROUP_STRATEGIES.map((s) => [s.id, s]));

export function listCommitGroupStrategies(): readonly CommitGroupStrategy[] {
  return COMMIT_GROUP_STRATEGIES;
}

export function defaultCommitGroupStrategy(): CommitGroupStrategy {
  const kind = COMMIT_GROUP_STRATEGIES[0];
  if (!kind) throw new Error("No commit-group strategies registered");
  return kind;
}

export function getCommitGroupStrategy(id?: string): CommitGroupStrategy {
  if (!id) return defaultCommitGroupStrategy();
  const kind = BY_ID.get(id);
  if (!kind) {
    throw new Error(
      `Unknown commit-group strategy "${id}". Use ${COMMIT_GROUP_STRATEGIES.map((s) => s.id).join(" or ")}.`,
    );
  }
  return kind;
}
