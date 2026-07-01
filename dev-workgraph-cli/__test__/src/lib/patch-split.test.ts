import { describe, expect, it } from "vitest";
import { isNoise } from "../../../src/lib/noise.js";
import {
  filterPatchNoise,
  isEmptySummarizePatch,
  MAX_PATCH_CHARS,
  packPatchIntoParts,
  pathsFromDiffGitLine,
  PATCH_TRUNCATED_MARKER,
  splitPatchByFile,
  truncatePatch,
} from "../../../src/lib/patch-split.js";

const HEADER = [
  "commit abc123",
  "Author: Dev <dev@example.com>",
  "Date:   Mon Jan 1 00:00:00 2024 +0000",
  "",
].join("\n");

function fileHunk(path: string, body: string): string {
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${body}\n`;
}

describe("splitPatchByFile", () => {
  it("splits commit header from file hunks", () => {
    const patch = `${HEADER}\n${fileHunk("src/a.ts", "+line")}${fileHunk("src/b.ts", "+other")}`;
    const { header, hunks } = splitPatchByFile(patch);
    expect(header).toContain("commit abc123");
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.paths).toEqual(["src/a.ts"]);
    expect(hunks[1]!.paths).toEqual(["src/b.ts"]);
  });
});

describe("pathsFromDiffGitLine", () => {
  it("parses simple paths", () => {
    expect(pathsFromDiffGitLine("diff --git a/src/a.ts b/src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("parses rename paths", () => {
    expect(pathsFromDiffGitLine("diff --git a/old.ts b/new.ts")).toEqual(["old.ts", "new.ts"]);
  });
});

describe("truncatePatch", () => {
  it("appends a marker when truncating", () => {
    const out = truncatePatch("x".repeat(30_000), MAX_PATCH_CHARS);
    expect(out.length).toBeLessThanOrEqual(MAX_PATCH_CHARS);
    expect(out).toContain(PATCH_TRUNCATED_MARKER);
  });
});

describe("filterPatchNoise", () => {
  it("drops noise hunks and keeps authored source", () => {
    const patch = `${HEADER}\n${fileHunk(".gitignore", "+node_modules/")}${fileHunk("README.md", "+# App")}`;
    const filtered = filterPatchNoise(patch, isNoise);
    expect(filtered).toContain("README.md");
    expect(filtered).not.toContain(".gitignore");
    expect(filtered).toContain("commit abc123");
  });

  it("returns only the commit header when every hunk is noise", () => {
    const patch = `${HEADER}\n${fileHunk("package-lock.json", "+{")}`;
    const filtered = filterPatchNoise(patch, isNoise);
    expect(filtered).toContain("commit abc123");
    expect(filtered).not.toContain("diff --git");
  });

  it("runs before packing so noise does not consume part budget", () => {
    const noiseBody = `+${"n".repeat(20_000)}\n`;
    const patch = `${HEADER}\n${fileHunk(".gitlab-ci.yml", noiseBody)}${fileHunk("src/a.ts", "+code")}`;
    const filtered = filterPatchNoise(patch, isNoise);
    const parts = packPatchIntoParts(filtered);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.patch).toContain("src/a.ts");
    expect(parts[0]!.patch).not.toContain(".gitlab-ci.yml");
  });
});

describe("isEmptySummarizePatch", () => {
  it("treats empty and header-only patches as empty", () => {
    expect(isEmptySummarizePatch("")).toBe(true);
    expect(isEmptySummarizePatch("   \n")).toBe(true);
    expect(isEmptySummarizePatch(HEADER)).toBe(true);
    expect(isEmptySummarizePatch(`${HEADER}\n`)).toBe(true);
  });

  it("returns false when diff hunks are present", () => {
    expect(isEmptySummarizePatch(`${HEADER}\n${fileHunk("src/a.ts", "+x")}`)).toBe(false);
  });
});

describe("packPatchIntoParts", () => {
  it("returns a single part for small patches", () => {
    const patch = `${HEADER}\n${fileHunk("src/a.ts", "+x")}`;
    const parts = packPatchIntoParts(patch);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.patchTruncated).toBe(false);
  });

  it("packs multiple file hunks into ~24k parts", () => {
    const big = "+\n".repeat(12_000);
    const patch = `${HEADER}\n${fileHunk("src/a.ts", big)}${fileHunk("src/b.ts", big)}`;
    const parts = packPatchIntoParts(patch);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.patch.length).toBeLessThanOrEqual(MAX_PATCH_CHARS);
    }
  });

  it("truncates an oversized single-file hunk", () => {
    const huge = `+${"x".repeat(50_000)}\n`;
    const patch = `${HEADER}\n${fileHunk("src/big.ts", huge)}`;
    const parts = packPatchIntoParts(patch);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.patchTruncated).toBe(true);
    expect(parts[0]!.patch.length).toBeLessThanOrEqual(MAX_PATCH_CHARS);
    expect(parts[0]!.paths).toEqual(["src/big.ts"]);
  });
});
