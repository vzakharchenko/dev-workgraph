// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { Command } from "commander";
import { COMMIT_GROUP_STRATEGIES, getCommitGroupStrategy } from "./registry.js";

/** Registers per-strategy CLI flags on a Commander command. */
export function registerCommitGroupStrategyOptions(command: Command): Command {
  for (const strategy of COMMIT_GROUP_STRATEGIES) {
    for (const opt of strategy.cliOptions) {
      if (opt.parse) {
        command.option(opt.flags, opt.description, opt.parse);
      } else {
        command.option(opt.flags, opt.description);
      }
    }
  }
  return command;
}

/** Extracts strategy-specific flags from Commander-parsed options. */
export function pickCommitGroupStrategyOptions(
  strategyId: string | undefined,
  opts: Record<string, unknown>,
): Record<string, unknown> {
  return getCommitGroupStrategy(strategyId).pickCliOptions(opts);
}
