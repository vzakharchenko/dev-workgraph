import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import type { CommitGroupStrategy } from "../../../../src/lib/commit-group/types.js";

const { plainStrategy, dayGapStub } = vi.hoisted(() => {
  const dayGap: CommitGroupStrategy = {
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
    init: async () => ({ label: "day-gap", params: {} }),
    gatherRunInputs: async () => ({}),
    partition: async () => ({
      buckets: [],
      stats: { rawBucketCount: 0, pendingCount: 0, fullyCovered: 0 },
    }),
    formatSummary: () => "",
  };
  const plain: CommitGroupStrategy = {
    id: "plain",
    displayName: "Plain flags",
    cliOptions: [{ flags: "--plain <x>", description: "A flag without a custom parser" }],
    pickCliOptions: () => ({}),
    init: async () => ({ label: "plain", params: {} }),
    gatherRunInputs: async () => ({}),
    partition: async () => ({
      buckets: [],
      stats: { rawBucketCount: 0, pendingCount: 0, fullyCovered: 0 },
    }),
    formatSummary: () => "",
  };
  return { plainStrategy: plain, dayGapStub: dayGap };
});

vi.mock("../../../../src/lib/commit-group/registry.js", () => ({
  COMMIT_GROUP_STRATEGIES: [plainStrategy, dayGapStub],
  getCommitGroupStrategy: (id?: string) => {
    if (!id || id === "day-gap") return dayGapStub;
    if (id === "plain") return plainStrategy;
    throw new Error(`Unknown commit-group strategy "${id}". Use day-gap or plain.`);
  },
}));

import {
  pickCommitGroupStrategyOptions,
  registerCommitGroupStrategyOptions,
} from "../../../../src/lib/commit-group/cli-options.js";

describe("commit-group cli-options", () => {
  it("registerCommitGroupStrategyOptions adds strategy flags with and without parsers", () => {
    const cmd = registerCommitGroupStrategyOptions(new Command("commit-group"));
    const optionFlags = cmd.options.map((o) => o.flags);
    expect(optionFlags).toContain("--plain <x>");
    expect(optionFlags).toContain("--days <n>");
    expect(optionFlags).toContain("--max-commits <n>");
  });

  it("pickCommitGroupStrategyOptions delegates to the active strategy", () => {
    expect(
      pickCommitGroupStrategyOptions("day-gap", { days: 5, maxCommits: 10, limit: 2 }),
    ).toEqual({ days: 5, maxCommits: 10 });
    expect(pickCommitGroupStrategyOptions(undefined, {})).toEqual({});
  });
});
