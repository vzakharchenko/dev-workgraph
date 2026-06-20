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
import { repoGroupsDir } from "../../src/lib/config.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../src/lib/ollama.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/ollama.js")>();
  return {
    ...actual,
    chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
      chatJsonFromSchema(opts.schema),
    ),
    resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  };
});

vi.mock("../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

import { commitGroup } from "../../src/actions/commit-group.js";

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
      force: true,
    });
    const groupFile = path.join(repoGroupsDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(groupFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(groupFile, "utf8")) as {
      model: { history: string } | null;
    };
    expect(record.model?.history).toBe("Session history narrative.");
  });

  it("skips groups that already have a model layer", async () => {
    seedCommit(FAKE_REPO, summarizedCommit("abc1234567890abc1234567890abc1234567890"));
    await commitGroup({
      repo: FAKE_REPO,
      days: 7,
      maxCommits: 20,
      model: "test-model",
      force: true,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await commitGroup({ repo: FAKE_REPO, days: 7, maxCommits: 20, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped 1"));
  });
});
