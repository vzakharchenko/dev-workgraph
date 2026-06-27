import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedCommit,
  setupWorkgraphHome,
  summarizedCommit,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { sampleModel } from "../../helpers.js";
import { repoGroupsDir } from "../../../src/lib/config.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../../src/lib/ollama.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/ollama.js")>();
  return {
    ...actual,
    chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
      chatJsonFromSchema(opts.schema),
    ),
    resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  };
});

vi.mock("../../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

import { commitGroup } from "../../../src/actions/commit-group.js";

describe("commitGroup", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    writeProjectContext(FAKE_REPO);
    promptMock.mockReset();
    promptMock.mockResolvedValueOnce({ days: 7 }).mockResolvedValueOnce({ maxCommits: 20 });
  });

  afterEach(() => {
    restoreHome();
  });

  it("does nothing without exported commits", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await commitGroup({ repo: FAKE_REPO, days: 7, maxCommits: 20, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No exported commits"));
  });

  it("writes summarized group records", async () => {
    seedCommit(FAKE_REPO, summarizedCommit("abc1234567890abc1234567890abc1234567890"));
    await commitGroup({
      repo: FAKE_REPO,
      days: 7,
      maxCommits: 20,
      model: "test-model",
    });
    const groupFile = path.join(repoGroupsDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(groupFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(groupFile, "utf8")) as {
      model: { history: string } | null;
      groups: { sourceEvidence: string[]; sourceSummaries: (string | null)[] };
    };
    expect(record.model?.history).toBe("Session history narrative.");
    expect(record.groups.sourceEvidence).toEqual(["1700000000"]);
    expect(record.groups.sourceSummaries).toEqual([
      "summaries/1700000000/abc1234567890abc1234567890abc1234567890.json",
    ]);
  });

  it("skips groups that already have a model layer", async () => {
    seedCommit(FAKE_REPO, summarizedCommit("abc1234567890abc1234567890abc1234567890"));
    await commitGroup({
      repo: FAKE_REPO,
      days: 7,
      maxCommits: 20,
      model: "test-model",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await commitGroup({ repo: FAKE_REPO, days: 7, maxCommits: 20, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped 1"));
  });

  it("summarizes only new commits when a session is extended", async () => {
    const day = 86_400;
    const hash = (n: number) => `${n}`.padStart(40, "a");

    seedCommit(FAKE_REPO, {
      commitHash: hash(1),
      timestamp: 1_700_000_000,
      model: sampleModel({ summary: "first" }),
    });
    seedCommit(FAKE_REPO, {
      commitHash: hash(2),
      timestamp: 1_700_000_000 + day,
      model: sampleModel({ summary: "second" }),
    });
    seedCommit(FAKE_REPO, {
      commitHash: hash(3),
      timestamp: 1_700_000_000 + day * 2,
      model: sampleModel({ summary: "third" }),
    });

    await commitGroup({
      repo: FAKE_REPO,
      days: 7,
      maxCommits: 20,
      model: "test-model",
    });

    const firstGroupFile = path.join(
      repoGroupsDir(FAKE_REPO),
      `${1_700_000_000 + day * 2}.json`,
    );
    expect(fs.existsSync(firstGroupFile)).toBe(true);
    const firstGroup = JSON.parse(fs.readFileSync(firstGroupFile, "utf8")) as {
      commitCount: number;
      groups: { commits: string[] };
    };
    expect(firstGroup.commitCount).toBe(3);
    expect(firstGroup.groups.commits).toEqual([hash(1), hash(2), hash(3)]);

    seedCommit(FAKE_REPO, {
      commitHash: hash(4),
      timestamp: 1_700_000_000 + day * 3,
      model: sampleModel({ summary: "fourth" }),
    });
    seedCommit(FAKE_REPO, {
      commitHash: hash(5),
      timestamp: 1_700_000_000 + day * 4,
      model: sampleModel({ summary: "fifth" }),
    });

    await commitGroup({ repo: FAKE_REPO, days: 7, maxCommits: 20, model: "test-model" });

    const extensionFile = path.join(repoGroupsDir(FAKE_REPO), `${1_700_000_000 + day * 4}.json`);
    expect(fs.existsSync(extensionFile)).toBe(true);
    const extension = JSON.parse(fs.readFileSync(extensionFile, "utf8")) as {
      commitCount: number;
      groups: { commits: string[] };
    };
    expect(extension.commitCount).toBe(2);
    expect(extension.groups.commits).toEqual([hash(4), hash(5)]);
    expect(fs.readdirSync(repoGroupsDir(FAKE_REPO)).filter((f) => f.endsWith(".json"))).toEqual(
      expect.arrayContaining([
        `${1_700_000_000 + day * 2}.json`,
        `${1_700_000_000 + day * 4}.json`,
      ]),
    );
  });
});
