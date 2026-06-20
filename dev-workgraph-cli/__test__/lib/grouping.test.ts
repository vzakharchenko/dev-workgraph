import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateDeterministic,
  groupByGap,
  loadCommitRecords,
  loadGroupRecords,
  mergeDeterministic,
  partitionTiers,
  tierOf,
} from "../../src/lib/grouping.js";
import { emptyDeterministic, sampleCommit, sampleGroup, sampleModel } from "../helpers.js";

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
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it("returns empty array for missing directory", () => {
    expect(loadCommitRecords("/tmp/missing-commits-dir-xyz")).toEqual([]);
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
