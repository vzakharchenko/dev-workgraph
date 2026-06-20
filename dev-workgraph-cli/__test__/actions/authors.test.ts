import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  sampleGitCommit,
  setupWorkgraphHome,
} from "../helpers/action-fixtures.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
  getAuthors: vi.fn(() => [
    { email: "dev@example.com", name: "Dev", commits: 3 },
    { email: "other@example.com", name: "Other", commits: 1 },
  ]),
  currentUserEmail: vi.fn(() => "dev@example.com"),
  getCommits: vi.fn(() => [sampleGitCommit]),
  getPatch: vi.fn(() => "commit patch"),
  getChangedFiles: vi.fn(() => [{ status: "M", path: "src/a.ts" }]),
  getChurn: vi.fn(() => ({ added: 5, deleted: 1 })),
}));

import { getRepoConfig } from "../../src/lib/config.js";
import { authors } from "../../src/actions/authors.js";

describe("authors", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    promptMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
  });

  it("prints JSON listing without saving", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await authors({ repo: FAKE_REPO, json: true });
    const payload = JSON.parse(log.mock.calls[0]?.[0] as string) as { authors: unknown[] };
    expect(payload.authors).toHaveLength(2);
  });

  it("persists authors selected via --email", async () => {
    await authors({ repo: FAKE_REPO, email: ["dev@example.com"] });
    expect(getRepoConfig(FAKE_REPO)?.selectedAuthors).toEqual(["dev@example.com"]);
  });

  it("warns and skips when --email matches nobody", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await authors({ repo: FAKE_REPO, email: ["missing@example.com"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Not found in history"));
    expect(getRepoConfig(FAKE_REPO)).toBeUndefined();
  });

  it("saves interactive checkbox selection", async () => {
    promptMock.mockResolvedValue({ picked: ["dev@example.com"] });
    await authors({ repo: FAKE_REPO });
    expect(getRepoConfig(FAKE_REPO)?.selectedAuthors).toEqual(["dev@example.com"]);
  });

  it("does nothing when interactive selection is empty", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    promptMock.mockResolvedValue({ picked: [] });
    await authors({ repo: FAKE_REPO });
    expect(log).toHaveBeenCalledWith("No authors selected; nothing saved.");
  });
});
