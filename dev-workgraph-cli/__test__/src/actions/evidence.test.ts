import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_REPO,
  sampleGitCommit,
  setupWorkgraphHome,
} from "../helpers/action-fixtures.js";
import { repoCommitsDir, setPeriod, setRepoConfig } from "../../../src/lib/config.js";

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
  getCommits: vi.fn(() => [sampleGitCommit]),
  getPatch: vi.fn(() => "commit patch"),
  getChangedFiles: vi.fn(() => [{ status: "M", path: "src/a.ts" }]),
  getChurn: vi.fn(() => ({ added: 5, deleted: 1 })),
}));

import { evidence } from "../../../src/actions/evidence.js";

describe("evidence", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
  });

  it("fails without selected authors", async () => {
    await evidence({ repo: FAKE_REPO });
    expect(process.exitCode).toBe(1);
  });

  it("extracts patch and JSON for selected commits", async () => {
    setRepoConfig(FAKE_REPO, { selectedAuthors: ["dev@example.com"] });
    await evidence({ repo: FAKE_REPO });
    const jsonPath = path.join(
      repoCommitsDir(FAKE_REPO),
      String(sampleGitCommit.timestamp),
      `${sampleGitCommit.hash}.json`,
    );
    expect(fs.existsSync(jsonPath)).toBe(true);
    const record = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as { model: null; title: string };
    expect(record.model).toBeNull();
    expect(record.title).toBe("Add feature");
  });

  it("skips existing exports on re-run", async () => {
    setRepoConfig(FAKE_REPO, { selectedAuthors: ["dev@example.com"] });
    await evidence({ repo: FAKE_REPO });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await evidence({ repo: FAKE_REPO });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped 1"));
  });

  it("scopes extraction to a configured period", async () => {
    setRepoConfig(FAKE_REPO, { selectedAuthors: ["dev@example.com"] });
    setPeriod(FAKE_REPO, "2022", { from: "2022-01-01", to: "2023-01-01" });
    await evidence({ repo: FAKE_REPO, period: "2022" });
    expect(
      fs.existsSync(
        path.join(repoCommitsDir(FAKE_REPO, "2022"), String(sampleGitCommit.timestamp)),
      ),
    ).toBe(true);
  });
});
