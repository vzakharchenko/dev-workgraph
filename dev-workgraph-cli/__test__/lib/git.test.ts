import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isNoise } from "../../src/lib/noise.js";
import {
  currentUserEmail,
  getAuthors,
  getChangedFiles,
  getChurn,
  getCommits,
  getPatch,
  resolveRepo,
} from "../../src/lib/git.js";

const cliRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = execFileSync("git", ["-C", cliRoot, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const sampleEmail = "vaszakharchenko@gmail.com";
const sampleHash = execFileSync(
  "git",
  ["-C", repoRoot, "log", "-1", "--format=%H", `--author=${sampleEmail}`],
  { encoding: "utf8" },
).trim();

describe("resolveRepo", () => {
  it("resolves the git top-level for this workspace", () => {
    expect(resolveRepo(cliRoot)).toBe(repoRoot);
  });

  it("rejects missing paths", () => {
    expect(() => resolveRepo("/tmp/dev-workgraph-nonexistent-path-xyz")).toThrow(
      /does not exist/i,
    );
  });

  it("rejects paths outside a git repository", () => {
    expect(() => resolveRepo("/tmp")).toThrow(/not a git repository/i);
  });
});

describe("getAuthors", () => {
  it("returns authors sorted by commit count", () => {
    const authors = getAuthors(repoRoot);
    expect(authors.length).toBeGreaterThan(0);
    expect(authors[0]?.email).toMatch(/@/);
    for (let i = 1; i < authors.length; i += 1) {
      expect(authors[i - 1]?.commits).toBeGreaterThanOrEqual(authors[i]?.commits ?? 0);
    }
  });
});

describe("getCommits", () => {
  it("filters commits by author email", () => {
    const commits = getCommits(repoRoot, [sampleEmail]);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((c) => c.email === sampleEmail.toLowerCase())).toBe(true);
    expect(commits.every((c, i) => i === 0 || c.timestamp >= commits[i - 1]!.timestamp)).toBe(
      true,
    );
  });

  it("applies half-open author timestamp range", () => {
    const all = getCommits(repoRoot, [sampleEmail]);
    const last = all.at(-1)!;
    const ranged = getCommits(repoRoot, [sampleEmail], {
      from: last.timestamp,
      to: last.timestamp + 1,
    });
    expect(ranged).toEqual([last]);
  });

  it("returns empty for unknown authors", () => {
    expect(getCommits(repoRoot, ["nobody@example.invalid"])).toEqual([]);
  });
});

describe("getPatch", () => {
  it("returns fuller patch for a real commit", () => {
    const patch = getPatch(repoRoot, sampleHash);
    expect(patch).toContain("commit ");
    expect(patch.length).toBeGreaterThan(20);
  });
});

describe("getChangedFiles", () => {
  it("returns changed files for a real commit", () => {
    const files = getChangedFiles(repoRoot, sampleHash);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.path.length > 0)).toBe(true);
  });
});

describe("getChurn", () => {
  it("sums non-noise line churn for a real commit", () => {
    const churn = getChurn(repoRoot, sampleHash, isNoise);
    expect(churn.added).toBeGreaterThanOrEqual(0);
    expect(churn.deleted).toBeGreaterThanOrEqual(0);
  });
});

describe("currentUserEmail", () => {
  it("returns configured git user email when set", () => {
    const email = currentUserEmail(repoRoot);
    if (email) expect(email).toMatch(/@/);
  });
});
