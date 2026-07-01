import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateDeterministic,
  coveredCommitHashes,
  extensionSessions,
  groupByGap,
  loadCommitRecords,
  loadGroupRecords,
  mergeDeterministic,
  partitionTiers,
  tierOf,
} from "../../../src/lib/grouping.js";
import { emptyDeterministic, sampleCommit, sampleGroup, sampleGroupModel, sampleModel } from "../../helpers.js";

describe("groupByGap", () => {
  const day = 86_400;

  it("starts a new group when the gap exceeds the threshold", () => {
    const commits = [
      sampleCommit({ commitHash: "a", timestamp: 0 }),
      sampleCommit({ commitHash: "b", timestamp: day * 2 }),
    ];
    expect(groupByGap(commits, 1)).toEqual([ [commits[0]], [commits[1]] ]);
  });

  it("keeps consecutive commits in one group within the threshold", () => {
    const commits = [
      sampleCommit({ commitHash: "a", timestamp: 0 }),
      sampleCommit({ commitHash: "b", timestamp: day }),
    ];
    expect(groupByGap(commits, 2)).toEqual([commits]);
  });

  it("splits when maxCommits is reached", () => {
    const commits = [
      sampleCommit({ commitHash: "a", timestamp: 0 }),
      sampleCommit({ commitHash: "b", timestamp: 1 }),
      sampleCommit({ commitHash: "c", timestamp: 2 }),
    ];
    expect(groupByGap(commits, 30, 2)).toEqual([
      [commits[0], commits[1]],
      [commits[2]],
    ]);
  });
});

describe("mergeDeterministic", () => {
  it("unions paths and sums churn", () => {
    const a = emptyDeterministic({
      changedFiles: { added: ["a.ts"], deleted: [], modified: [], renamed: [] },
      linesAdded: 10,
      areas: ["src"],
    });
    const b = emptyDeterministic({
      changedFiles: { added: ["b.ts"], deleted: [], modified: ["a.ts"], renamed: [] },
      linesAdded: 5,
      linesDeleted: 2,
      areas: ["docs"],
    });
    const merged = mergeDeterministic(a, b);
    expect(merged.changedFiles.added).toEqual(["a.ts", "b.ts"]);
    expect(merged.changedFiles.modified).toEqual(["a.ts"]);
    expect(merged.linesAdded).toBe(15);
    expect(merged.linesDeleted).toBe(2);
    expect(merged.areas).toEqual(["docs", "src"]);
  });
});

describe("aggregateDeterministic", () => {
  it("aggregates member commit layers", () => {
    const members = [
      sampleCommit({
        commitHash: "a",
        deterministic: emptyDeterministic({ linesAdded: 3, areas: ["backend"] }),
      }),
      sampleCommit({
        commitHash: "b",
        deterministic: emptyDeterministic({ linesAdded: 7, areas: ["docker"] }),
      }),
    ];
    const agg = aggregateDeterministic(members);
    expect(agg.linesAdded).toBe(10);
    expect(agg.areas).toEqual(["backend", "docker"]);
  });
});

describe("tierOf", () => {
  it("classifies by per-commit signals", () => {
    expect(tierOf(sampleCommit({ commitHash: "a", model: null }))).toBe("low");
    expect(
      tierOf(
        sampleCommit({
          commitHash: "b",
          model: sampleModel({ technicalSignal: "high" }),
        }),
      ),
    ).toBe("hi");
    expect(
      tierOf(
        sampleCommit({
          commitHash: "c",
          model: sampleModel({ architectureSignal: "medium" }),
        }),
      ),
    ).toBe("medium");
  });
});

describe("partitionTiers", () => {
  it("places each hash in exactly one tier bucket", () => {
    const members = [
      sampleCommit({ commitHash: "hi", model: sampleModel({ technicalSignal: "high" }) }),
      sampleCommit({ commitHash: "med", model: sampleModel({ technicalSignal: "medium" }) }),
      sampleCommit({ commitHash: "low", model: null }),
    ];
    const tiers = partitionTiers(members);
    expect(tiers).toEqual({
      hi: ["hi"],
      medium: ["med"],
      low: ["low"],
    });
  });
});

describe("loadCommitRecords", () => {
  let tmpDir: string | undefined;
  let extraDirs: string[] = [];

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDir = undefined;
    extraDirs = [];
  });

  it("loads commit JSON files sorted by timestamp", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-commits-"));
    const older = sampleCommit({ commitHash: "older", timestamp: 100 });
    const newer = sampleCommit({ commitHash: "newer", timestamp: 200 });
    fs.mkdirSync(path.join(tmpDir, "100"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "200"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "100/older.json"), JSON.stringify(older));
    fs.writeFileSync(path.join(tmpDir, "200/newer.json"), JSON.stringify(newer));
    expect(loadCommitRecords(tmpDir).map((c) => c.commitHash)).toEqual(["older", "newer"]);
  });

  it("merges evidence with summaries from a sibling directory", () => {
    const commitsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-commits-"));
    const summariesDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-summaries-"));
    tmpDir = commitsDir;
    extraDirs = [summariesDir];
    const evidence = sampleCommit({ commitHash: "abc", timestamp: 100, model: null });
    fs.mkdirSync(path.join(commitsDir, "100"), { recursive: true });
    fs.writeFileSync(
      path.join(commitsDir, "100/abc.json"),
      JSON.stringify({
        commitHash: evidence.commitHash,
        timestamp: evidence.timestamp,
        title: evidence.title,
        author: evidence.author,
        deterministic: evidence.deterministic,
      }),
    );
    fs.mkdirSync(path.join(summariesDir, "100"), { recursive: true });
    fs.writeFileSync(
      path.join(summariesDir, "100/abc.json"),
      JSON.stringify({
        commitHash: "abc",
        timestamp: 100,
        model: sampleModel({ summary: "from summary file" }),
      }),
    );
    const merged = loadCommitRecords(commitsDir, summariesDir)[0];
    expect(merged?.model?.summary).toBe("from summary file");
  });

  it("loads split commits when canonical summary exists", () => {
    const commitsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-commits-split-"));
    const summariesDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-summaries-split-"));
    tmpDir = commitsDir;
    extraDirs = [summariesDir];
    const hash = "splitcommit";
    fs.mkdirSync(path.join(commitsDir, "100"), { recursive: true });
    fs.writeFileSync(
      path.join(commitsDir, "100", `${hash}.json`),
      JSON.stringify({
        commitHash: hash,
        timestamp: 100,
        title: "Init",
        author: { email: "dev@example.com", name: "Dev" },
        deterministic: sampleCommit({ commitHash: hash }).deterministic,
        split: true,
        partCount: 2,
      }),
    );
    fs.mkdirSync(path.join(summariesDir, "100"), { recursive: true });
    fs.writeFileSync(
      path.join(summariesDir, "100", `${hash}.merge.json`),
      JSON.stringify({
        commitHash: hash,
        timestamp: 100,
        model: sampleModel({ summary: "merge only" }),
      }),
    );
    expect(loadCommitRecords(commitsDir, summariesDir)).toEqual([]);

    fs.writeFileSync(
      path.join(summariesDir, "100", `${hash}.json`),
      JSON.stringify({
        commitHash: hash,
        timestamp: 100,
        model: sampleModel({ summary: "canonical summary" }),
      }),
    );
    const records = loadCommitRecords(commitsDir, summariesDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.model?.summary).toBe("canonical summary");
  });

  it("falls back to legacy inlined model when no summary file exists", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-commits-legacy-"));
    const legacy = sampleCommit({
      commitHash: "legacy",
      timestamp: 100,
      model: sampleModel({ summary: "legacy inline" }),
    });
    fs.mkdirSync(path.join(tmpDir, "100"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "100/legacy.json"), JSON.stringify(legacy));
    expect(loadCommitRecords(tmpDir)[0]?.model?.summary).toBe("legacy inline");
  });

  it("returns empty array for missing directory", () => {
    expect(loadCommitRecords("/tmp/missing-commits-dir-xyz")).toEqual([]);
  });
});

describe("extensionSessions", () => {
  const day = 86_400;

  it("returns only uncovered commits when a session was extended", () => {
    const c1 = sampleCommit({ commitHash: "a", timestamp: 0 });
    const c2 = sampleCommit({ commitHash: "b", timestamp: day });
    const c3 = sampleCommit({ commitHash: "c", timestamp: day * 2 });
    const c4 = sampleCommit({ commitHash: "d", timestamp: day * 3 });
    const sessions = groupByGap([c1, c2, c3, c4], 7);
    const covered = new Set(["a", "b", "c"]);
    expect(extensionSessions(sessions, covered)).toEqual([[c4]]);
  });

  it("drops sessions that are fully covered", () => {
    const day = 86_400;
    const c1 = sampleCommit({ commitHash: "a", timestamp: 0 });
    const c2 = sampleCommit({ commitHash: "b", timestamp: day });
    const sessions = groupByGap([c1, c2], 7);
    expect(extensionSessions(sessions, new Set(["a", "b"]))).toEqual([]);
  });
});

describe("coveredCommitHashes", () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects hashes only from groups that have a model layer", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-covered-"));
    const summarized = sampleGroup({
      timestampEnd: 100,
      groups: { commits: ["a", "b"], tiers: { hi: [], medium: [], low: ["a", "b"] } },
      model: sampleGroupModel(),
    });
    const pending = sampleGroup({
      timestampEnd: 200,
      groups: { commits: ["c"], tiers: { hi: [], medium: [], low: ["c"] } },
      model: null,
    });
    fs.writeFileSync(path.join(tmpDir, "100.json"), JSON.stringify(summarized));
    fs.writeFileSync(path.join(tmpDir, "200.json"), JSON.stringify(pending));
    expect([...coveredCommitHashes(tmpDir)].sort()).toEqual(["a", "b"]);
  });
});

describe("loadGroupRecords", () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads group records sorted by timestampEnd", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-groups-"));
    const early = sampleGroup({ groupId: 1, timestampEnd: 100 });
    const late = sampleGroup({ groupId: 2, timestampEnd: 200 });
    fs.writeFileSync(path.join(tmpDir, "1000.json"), JSON.stringify(early));
    fs.writeFileSync(path.join(tmpDir, "2000.json"), JSON.stringify(late));
    const loaded = loadGroupRecords(tmpDir);
    expect(loaded.map((g) => g.record.groupId)).toEqual([1, 2]);
  });
});
