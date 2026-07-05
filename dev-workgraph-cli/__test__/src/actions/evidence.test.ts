import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_REPO,
  sampleGitCommit,
  setupWorkgraphHome,
} from "../helpers/action-fixtures.js";
import { repoCommitsDir, setPeriod, setRepoConfig } from "../../../src/lib/config.js";
import { MAX_PATCH_CHARS } from "../../../src/lib/patch-split.js";

const { getPatch } = vi.hoisted(() => ({
  getPatch: vi.fn(() => "commit patch"),
}));

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
  getCommits: vi.fn(() => [sampleGitCommit]),
  getPatch,
  getChangedFiles: vi.fn(() => [{ status: "M", path: "src/a.ts" }]),
  getChurnForPaths: vi.fn(() => ({ added: 5, deleted: 1 })),
}));

import { evidence } from "../../../src/actions/evidence.js";

describe("evidence", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    process.exitCode = undefined;
    getPatch.mockReset();
    getPatch.mockReturnValue("commit patch");
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
    const record = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      title: string;
      model?: unknown;
      split?: boolean;
    };
    expect(record.model).toBeUndefined();
    expect(record.title).toBe("Add feature");
    expect(record.split).toBeUndefined();
  });

  it("splits oversized commits into part files without a monolithic patch", async () => {
    const lineChars = Math.ceil((MAX_PATCH_CHARS + 1_000) / 2);
    const body = `+${"x".repeat(lineChars)}\n`;
    const patch = [
      "commit abc",
      "Author: Dev <dev@example.com>",
      "",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      body,
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      body,
    ].join("\n");
    expect(patch.length).toBeGreaterThan(MAX_PATCH_CHARS);
    getPatch.mockReturnValue(patch);

    setRepoConfig(FAKE_REPO, { selectedAuthors: ["dev@example.com"] });
    await evidence({ repo: FAKE_REPO });

    const dir = path.join(repoCommitsDir(FAKE_REPO), String(sampleGitCommit.timestamp));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, `${sampleGitCommit.hash}.json`), "utf8"),
    ) as { split: boolean; partCount: number };

    expect(manifest.split).toBe(true);
    expect(manifest.partCount).toBeGreaterThan(1);
    expect(fs.existsSync(path.join(dir, `${sampleGitCommit.hash}.patch`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${sampleGitCommit.hash}.part1.patch`))).toBe(true);
    expect(fs.existsSync(path.join(dir, `${sampleGitCommit.hash}.part1.json`))).toBe(true);
  });

  it("filters noise files out of exported patches", async () => {
    const patch = [
      "commit abc",
      "Author: Dev <dev@example.com>",
      "",
      "diff --git a/.gitignore b/.gitignore",
      "--- /dev/null",
      "+++ b/.gitignore",
      "+node_modules/",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- /dev/null",
      "+++ b/src/a.ts",
      "+export const x = 1;",
    ].join("\n");
    getPatch.mockReturnValue(patch);

    setRepoConfig(FAKE_REPO, { selectedAuthors: ["dev@example.com"] });
    await evidence({ repo: FAKE_REPO });

    const patchPath = path.join(
      repoCommitsDir(FAKE_REPO),
      String(sampleGitCommit.timestamp),
      `${sampleGitCommit.hash}.patch`,
    );
    const written = fs.readFileSync(patchPath, "utf8");
    expect(written).toContain("src/a.ts");
    expect(written).not.toContain(".gitignore");
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
