import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoConfig, setRepoConfig } from "../../../../src/lib/config.js";
import { dayGapStrategy } from "../../../../src/lib/commit-group/day-gap-strategy.js";
import type { CommitGroupRunContext } from "../../../../src/lib/commit-group/types.js";
import { sampleCommit, sampleGroup, sampleGroupModel } from "../../../helpers.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

function runCtx(
  repoPath: string,
  overrides: Partial<CommitGroupRunContext> & { strategyCli?: Record<string, unknown> } = {},
): CommitGroupRunContext {
  const groupsDir = path.join(repoPath, "groups");
  fs.mkdirSync(groupsDir, { recursive: true });
  const commits = overrides.commits ?? [sampleCommit({ commitHash: "a".repeat(40), timestamp: 1_700_000_000 })];
  return {
    repoPath,
    groupsDir,
    commits,
    allCommitCount: overrides.allCommitCount ?? commits.length,
    emptySkipped: overrides.emptySkipped ?? 0,
    options: {
      strategyCli: overrides.strategyCli ?? {},
      limit: overrides.limit,
      period: overrides.period,
    },
    ...overrides,
  };
}

describe("dayGapStrategy", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  const repoPath = "/tmp/day-gap-repo";

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-day-gap-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
    promptMock.mockReset();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("pickCliOptions keeps only days and maxCommits", () => {
    expect(dayGapStrategy.pickCliOptions({ days: 3, maxCommits: 0, limit: 1 })).toEqual({
      days: 3,
      maxCommits: 0,
    });
    expect(dayGapStrategy.pickCliOptions({})).toEqual({});
  });

  it("cliOptions parse numeric flags", () => {
    const daysOpt = dayGapStrategy.cliOptions.find((o) => o.flags.startsWith("--days"));
    const maxOpt = dayGapStrategy.cliOptions.find((o) => o.flags.startsWith("--max-commits"));
    expect(daysOpt?.parse?.("14")).toBe(14);
    expect(maxOpt?.parse?.("0")).toBe(0);
  });

  it("gatherRunInputs uses CLI flags without prompting", async () => {
    const cli = await dayGapStrategy.gatherRunInputs(repoPath, { days: 9, maxCommits: 15 });
    expect(promptMock).not.toHaveBeenCalled();
    expect(cli).toEqual({ days: 9, maxCommits: 15 });
    expect(getRepoConfig(repoPath)?.groupThresholdDays).toBe(9);
    expect(getRepoConfig(repoPath)?.groupMaxCommits).toBe(15);
  });

  it("gatherRunInputs with skipPromptIfSaved uses persisted values without prompting", async () => {
    setRepoConfig(repoPath, { groupThresholdDays: 6, groupMaxCommits: 8 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const cli = await dayGapStrategy.gatherRunInputs(repoPath, {}, { skipPromptIfSaved: true });

    expect(promptMock).not.toHaveBeenCalled();
    expect(cli).toEqual({ days: 6, maxCommits: 8 });
    expect(log).toHaveBeenCalledWith("Using saved group threshold: 6 day(s)");
    expect(log).toHaveBeenCalledWith("Using saved max commits/group: 8");
    log.mockRestore();
  });

  it("gatherRunInputs prompts when skipPromptIfSaved is false even with saved config", async () => {
    setRepoConfig(repoPath, { groupThresholdDays: 6, groupMaxCommits: 8 });
    promptMock.mockResolvedValueOnce({ days: 6 }).mockResolvedValueOnce({ maxCommits: 8 });

    await dayGapStrategy.gatherRunInputs(repoPath);

    expect(promptMock).toHaveBeenCalledTimes(2);
  });

  it("init delegates to gatherRunInputs", async () => {
    const ctx = runCtx(repoPath, { strategyCli: { days: 9, maxCommits: 15 } });
    const init = await dayGapStrategy.init(ctx);
    expect(promptMock).not.toHaveBeenCalled();
    expect(init).toEqual({
      label: "9-day gap, max 15 commits/group",
      params: { thresholdDays: 9, maxCommits: 15 },
    });
    expect(getRepoConfig(repoPath)?.groupThresholdDays).toBe(9);
    expect(getRepoConfig(repoPath)?.groupMaxCommits).toBe(15);
  });

  it("init accepts zero maxCommits from CLI", async () => {
    const init = await dayGapStrategy.init(
      runCtx(repoPath, { strategyCli: { days: 7, maxCommits: 0 } }),
    );
    expect(init.label).toContain("∞");
    expect(init.params.maxCommits).toBe(0);
  });

  it("init ignores non-positive CLI days and prompts instead", async () => {
    promptMock.mockResolvedValueOnce({ days: 4 }).mockResolvedValueOnce({ maxCommits: 10 });
    const init = await dayGapStrategy.init(
      runCtx(repoPath, { strategyCli: { days: 0, maxCommits: 10 } }),
    );
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(init.params.thresholdDays).toBe(4);
    expect(init.params.maxCommits).toBe(10);
  });

  it("init prompts and persists when flags are missing", async () => {
    promptMock
      .mockResolvedValueOnce({ days: 5 })
      .mockResolvedValueOnce({ maxCommits: 12 });
    const init = await dayGapStrategy.init(runCtx(repoPath));
    expect(promptMock).toHaveBeenCalledTimes(2);
    expect(init.params).toEqual({ thresholdDays: 5, maxCommits: 12 });
    expect(getRepoConfig(repoPath)).toMatchObject({
      groupThresholdDays: 5,
      groupMaxCommits: 12,
    });
  });

  it("init falls back when prompts return invalid numbers", async () => {
    setRepoConfig(repoPath, { groupThresholdDays: 6, groupMaxCommits: 8 });
    promptMock.mockResolvedValueOnce({ days: 0 }).mockResolvedValueOnce({ maxCommits: -1 });
    const init = await dayGapStrategy.init(runCtx(repoPath));
    expect(init.params).toEqual({ thresholdDays: 6, maxCommits: 8 });
  });

  it("partition builds buckets and incremental stats", async () => {
    const ctx = runCtx(repoPath, {
      commits: [
        sampleCommit({ commitHash: "a".repeat(40), timestamp: 0 }),
        sampleCommit({ commitHash: "b".repeat(40), timestamp: 86_400 }),
      ],
    });
    const init = { label: "test", params: { thresholdDays: 2, maxCommits: 0 } };
    const partition = await dayGapStrategy.partition(ctx.commits, init, ctx);
    expect(partition.buckets).toHaveLength(1);
    expect(partition.buckets[0]?.fileKey).toBe("86400");
    expect(partition.stats).toEqual({
      rawBucketCount: 1,
      pendingCount: 1,
      fullyCovered: 0,
    });
  });

  it("partition reports fully covered sessions", async () => {
    const ctx = runCtx(repoPath, {
      commits: [sampleCommit({ commitHash: "a".repeat(40), timestamp: 100 })],
    });
    fs.writeFileSync(
      path.join(ctx.groupsDir, "100.json"),
      JSON.stringify(
        sampleGroup({
          timestampEnd: 100,
          groups: {
            commits: ["a".repeat(40)],
            tiers: { hi: [], medium: [], low: ["a".repeat(40)] },
          },
          model: sampleGroupModel(),
        }),
      ),
    );
    const init = { label: "test", params: { thresholdDays: 7, maxCommits: 0 } };
    const partition = await dayGapStrategy.partition(ctx.commits, init, ctx);
    expect(partition.stats.fullyCovered).toBe(1);
    expect(partition.buckets).toHaveLength(0);
  });

  it("formatSummary includes skipped empties, caps, and pending counts", () => {
    const ctx = runCtx(repoPath, {
      allCommitCount: 3,
      emptySkipped: 1,
      commits: [sampleCommit({ commitHash: "a".repeat(40) })],
    });
    const init = { label: "test", params: { thresholdDays: 7, maxCommits: 5 } };
    const partition = {
      buckets: [{ members: ctx.commits, fileKey: "1700000000" }],
      stats: { rawBucketCount: 2, pendingCount: 1, fullyCovered: 1 },
    };
    const summary = dayGapStrategy.formatSummary(ctx, init, partition);
    expect(summary).toContain("3 commit(s) → 1 for grouping (1 empty summary skipped)");
    expect(summary).toContain("2 session(s) at 7-day threshold, max 5/group");
    expect(summary).toContain("1 fully covered");
    expect(summary).toContain("1 to summarize");
  });

  it("formatSummary omits optional fragments when not applicable", () => {
    const ctx = runCtx(repoPath);
    const init = { label: "test", params: { thresholdDays: 7, maxCommits: 0 } };
    const partition = {
      buckets: [],
      stats: { rawBucketCount: 0, pendingCount: 0, fullyCovered: 0 },
    };
    const summary = dayGapStrategy.formatSummary(ctx, init, partition);
    expect(summary).toBe("\n1 commit(s) → 0 session(s) at 7-day threshold.");
    expect(summary).not.toContain("empty summar");
    expect(summary).not.toContain("/group");
  });

  it("formatSummary pluralizes multiple skipped summaries", () => {
    const ctx = runCtx(repoPath, { allCommitCount: 4, emptySkipped: 2, commits: [] });
    const init = { label: "test", params: { thresholdDays: 3, maxCommits: 0 } };
    const partition = {
      buckets: [],
      stats: { rawBucketCount: 0, pendingCount: 0, fullyCovered: 0 },
    };
    expect(dayGapStrategy.formatSummary(ctx, init, partition)).toContain(
      "2 empty summaries skipped",
    );
  });
});
