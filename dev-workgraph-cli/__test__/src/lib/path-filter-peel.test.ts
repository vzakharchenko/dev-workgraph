import { describe, expect, it } from "vitest";
import {
  buildBucketManifestPatch,
  MAX_PATCH_CHARS,
  packPatchIntoParts,
  peelPatchByPaths,
  patchCommitHeader,
} from "../../../src/lib/patch-split.js";

const HEADER = "commit abc\nAuthor: Dev <dev@example.com>\n\n";

function fileHunk(filePath: string, body: string): string {
  return `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n${body}\n`;
}

describe("peelPatchByPaths", () => {
  it("moves hunks whose paths are excluded into bucketPaths", () => {
    const patch = `${HEADER}${fileHunk("src/a.ts", "+authored")}${fileHunk("build/out.bin", "+binary")}`;
    const { authoredPatch, bucketPaths } = peelPatchByPaths(patch, new Set(["build/out.bin"]));
    expect(bucketPaths).toEqual(["build/out.bin"]);
    expect(authoredPatch).toContain("src/a.ts");
    expect(authoredPatch).not.toContain("build/out.bin");
  });

  it("returns original patch when exclude set is empty", () => {
    const patch = `${HEADER}${fileHunk("src/a.ts", "+x")}`;
    const result = peelPatchByPaths(patch, new Set());
    expect(result.authoredPatch).toBe(patch);
    expect(result.bucketPaths).toEqual([]);
  });
});

describe("buildBucketManifestPatch", () => {
  it("twenty oversized file hunks exceed the path-filter part threshold", () => {
    const lines = ["commit abc", "Author: Dev <dev@example.com>", ""];
    for (let i = 0; i < 20; i += 1) {
      const p = `src/file${i}.ts`;
      lines.push(
        `diff --git a/${p} b/${p}`,
        `--- a/${p}`,
        `+++ b/${p}`,
        `+${"x".repeat(MAX_PATCH_CHARS)}`,
      );
    }
    expect(packPatchIntoParts(lines.join("\n")).length).toBeGreaterThan(15);
  });

  it("lists paths as comments without diff hunks", () => {
    const out = buildBucketManifestPatch(HEADER, ["gen/a.out", "gen/b.out"]);
    expect(out).toContain("# gen/a.out");
    expect(out).toContain("auto-generated");
    expect(out).not.toContain("diff --git");
  });

  it("preserves commit header", () => {
    const out = buildBucketManifestPatch(HEADER, ["x.bin"]);
    expect(patchCommitHeader(out)).toContain("commit abc");
  });
});
