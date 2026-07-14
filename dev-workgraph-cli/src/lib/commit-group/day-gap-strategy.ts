// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import inquirer from "inquirer";
import { getRepoConfig, setRepoConfig } from "../config.js";
import { coveredCommitHashes, extensionSessions, groupByGap } from "../grouping.js";
import type {
  CommitGroupInitResult,
  CommitGroupPartitionResult,
  CommitGroupRunContext,
  CommitGroupStrategy,
  GatherRunInputsOptions,
} from "./types.js";

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_MAX_COMMITS = 20;

interface DayGapParams {
  thresholdDays: number;
  maxCommits: number;
}

interface ResolveDayGapOpts extends GatherRunInputsOptions {}

function asDayGapParams(init: CommitGroupInitResult): DayGapParams {
  const { thresholdDays, maxCommits } = init.params;
  return {
    thresholdDays: Number(thresholdDays),
    maxCommits: Number(maxCommits),
  };
}

async function resolveThreshold(
  repoPath: string,
  flagDays?: number,
  opts?: ResolveDayGapOpts,
): Promise<number> {
  if (flagDays !== undefined && Number.isFinite(flagDays) && flagDays > 0) {
    setRepoConfig(repoPath, { groupThresholdDays: flagDays });
    return flagDays;
  }
  const cfg = getRepoConfig(repoPath);
  if (opts?.skipPromptIfSaved && cfg?.groupThresholdDays !== undefined) {
    console.log(`Using saved group threshold: ${cfg.groupThresholdDays} day(s)`);
    return cfg.groupThresholdDays;
  }
  const saved = cfg?.groupThresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  const { days } = await inquirer.prompt<{ days: number }>([
    {
      type: "number",
      name: "days",
      message: "Max days between commits before a new work-session group starts:",
      default: saved,
    },
  ]);
  const value = Number.isFinite(days) && days > 0 ? days : saved;
  setRepoConfig(repoPath, { groupThresholdDays: value });
  return value;
}

async function resolveMaxCommits(
  repoPath: string,
  flagMax?: number,
  opts?: ResolveDayGapOpts,
): Promise<number> {
  if (flagMax !== undefined && Number.isFinite(flagMax) && flagMax >= 0) {
    setRepoConfig(repoPath, { groupMaxCommits: flagMax });
    return flagMax;
  }
  const cfg = getRepoConfig(repoPath);
  if (opts?.skipPromptIfSaved && cfg?.groupMaxCommits !== undefined) {
    console.log(
      `Using saved max commits/group: ${cfg.groupMaxCommits === 0 ? "unlimited" : cfg.groupMaxCommits}`,
    );
    return cfg.groupMaxCommits;
  }
  const saved = cfg?.groupMaxCommits ?? DEFAULT_MAX_COMMITS;
  const { maxCommits } = await inquirer.prompt<{ maxCommits: number }>([
    {
      type: "number",
      name: "maxCommits",
      message: "Max commits per group (0 = unlimited):",
      default: saved,
    },
  ]);
  const value = Number.isFinite(maxCommits) && maxCommits >= 0 ? maxCommits : saved;
  setRepoConfig(repoPath, { groupMaxCommits: value });
  return value;
}

async function gatherDayGapInputs(
  repoPath: string,
  cli?: Record<string, unknown>,
  opts?: ResolveDayGapOpts,
): Promise<{ days: number; maxCommits: number }> {
  const resolvedCli = cli ?? {};
  const thresholdDays = await resolveThreshold(
    repoPath,
    resolvedCli.days as number | undefined,
    opts,
  );
  const maxCommits = await resolveMaxCommits(
    repoPath,
    resolvedCli.maxCommits as number | undefined,
    opts,
  );
  return { days: thresholdDays, maxCommits };
}

function formatDayGapSummary(
  ctx: CommitGroupRunContext,
  init: CommitGroupInitResult,
  partition: CommitGroupPartitionResult,
): string {
  const { thresholdDays, maxCommits } = asDayGapParams(init);
  const parts = [`\n${ctx.allCommitCount} commit(s)`];
  if (ctx.emptySkipped > 0) {
    parts.push(
      ` → ${ctx.commits.length} for grouping (${ctx.emptySkipped} empty summar${ctx.emptySkipped === 1 ? "y" : "ies"} skipped)`,
    );
  }
  parts.push(` → ${partition.stats.rawBucketCount} session(s) at ${thresholdDays}-day threshold`);
  if (maxCommits > 0) parts.push(`, max ${maxCommits}/group`);
  if (partition.stats.fullyCovered > 0) {
    parts.push(` · ${partition.stats.fullyCovered} fully covered`);
  }
  if (partition.stats.pendingCount > 0) {
    parts.push(` · ${partition.stats.pendingCount} to summarize`);
  }
  return `${parts.join("")}.`;
}

/** Default strategy: chronological work sessions separated by day gap. */
export const dayGapStrategy: CommitGroupStrategy = {
  id: "day-gap",
  displayName: "Work sessions by day gap",

  cliOptions: [
    {
      flags: "--days <n>",
      description: "Max days between commits before a new group (skips prompt)",
      parse: (v) => Number.parseInt(v, 10),
    },
    {
      flags: "--max-commits <n>",
      description: "Max commits per group, 0 = unlimited (skips prompt)",
      parse: (v) => Number.parseInt(v, 10),
    },
  ],

  pickCliOptions(opts) {
    const out: Record<string, unknown> = {};
    if (opts.days !== undefined) out.days = opts.days;
    if (opts.maxCommits !== undefined) out.maxCommits = opts.maxCommits;
    return out;
  },

  gatherRunInputs(repoPath, cli, opts) {
    return gatherDayGapInputs(repoPath, cli, opts);
  },

  async init(ctx) {
    const { days, maxCommits } = await gatherDayGapInputs(ctx.repoPath, ctx.options.strategyCli);
    return {
      label: `${days}-day gap, max ${maxCommits || "∞"} commits/group`,
      params: { thresholdDays: days, maxCommits },
    };
  },

  async partition(commits, init, ctx) {
    const { thresholdDays, maxCommits } = asDayGapParams(init);
    const rawSessions = groupByGap(commits, thresholdDays, maxCommits);
    const covered = coveredCommitHashes(ctx.groupsDir);
    const tails = extensionSessions(rawSessions, covered);

    const buckets = tails.map((members) => {
      const last = members.at(-1);
      if (!last) throw new Error("Empty group bucket");
      return {
        members,
        fileKey: String(last.timestamp),
      };
    });

    return {
      buckets,
      stats: {
        rawBucketCount: rawSessions.length,
        pendingCount: buckets.length,
        fullyCovered: rawSessions.length - tails.length,
      },
    };
  },

  formatSummary(ctx, init, partition) {
    return formatDayGapSummary(ctx, init, partition);
  },
};
