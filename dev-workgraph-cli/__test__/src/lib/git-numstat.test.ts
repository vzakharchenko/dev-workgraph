// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { getAuthors, getChurnForPaths, getCommits } from "../../../src/lib/git.js";

const UNIT = "\x1f";

describe("getChurnForPaths numstat normalization", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((...args: unknown[]) => {
      const gitArgs = args[1] as string[] | undefined;
      if (gitArgs?.includes("--numstat")) {
        return (execFileSyncMock as { numstat?: string }).numstat ?? "";
      }
      return "";
    });
  });

  afterEach(() => {
    delete (execFileSyncMock as { numstat?: string }).numstat;
  });

  function mockNumstat(output: string): void {
    (execFileSyncMock as { numstat?: string }).numstat = output;
  }

  it("counts churn for simple old => new rename paths", () => {
    mockNumstat("2\t1\told/file.ts => new/file.ts");
    expect(getChurnForPaths("/fake/repo", "abc123", () => false)).toEqual({
      added: 2,
      deleted: 1,
    });
  });

  it("normalizes brace rename segments in numstat paths", () => {
    mockNumstat("3\t0\tsrc/{oldName => newName}/index.ts");
    expect(
      getChurnForPaths("/fake/repo", "abc123", () => false, new Set(["src/newName/index.ts"])),
    ).toEqual({ added: 3, deleted: 0 });
  });

  it("keeps brace segments when no arrow is present", () => {
    mockNumstat("1\t0\tdir/{literal}/file.ts");
    expect(
      getChurnForPaths("/fake/repo", "abc123", () => false, new Set(["dir/{literal}/file.ts"])),
    ).toEqual({ added: 1, deleted: 0 });
  });

  it("handles unclosed braces without throwing", () => {
    mockNumstat("1\t0\tpath/{unclosed");
    expect(getChurnForPaths("/fake/repo", "abc123", () => false)).toEqual({
      added: 1,
      deleted: 0,
    });
  });

  it("collapses duplicate slashes after brace normalization", () => {
    mockNumstat("1\t0\tsrc//{a => b}//file.ts");
    expect(
      getChurnForPaths("/fake/repo", "abc123", () => false, new Set(["src/b/file.ts"])),
    ).toEqual({ added: 1, deleted: 0 });
  });

  it("skips binary numstat rows", () => {
    mockNumstat("-\t-\tbinary.png\n1\t0\tsrc/a.ts");
    expect(getChurnForPaths("/fake/repo", "abc123", () => false)).toEqual({
      added: 1,
      deleted: 0,
    });
  });

  it("skips noise paths and empty lines", () => {
    mockNumstat("\n2\t0\tnode_modules/pkg/index.js\n1\t0\tsrc/a.ts\n");
    expect(getChurnForPaths("/fake/repo", "abc123", (p) => p.startsWith("node_modules"))).toEqual({
      added: 1,
      deleted: 0,
    });
  });

  it("restricts churn to onlyPaths after normalization", () => {
    mockNumstat("5\t0\told/a.ts => new/a.ts\n9\t9\told/b.ts => new/b.ts");
    expect(
      getChurnForPaths("/fake/repo", "abc123", () => false, new Set(["new/b.ts"])),
    ).toEqual({ added: 9, deleted: 9 });
  });
});

describe("git log helpers", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns no commits when git log is empty", () => {
    execFileSyncMock.mockReturnValue("");
    expect(getCommits("/fake/repo", ["dev@example.com"])).toEqual([]);
  });

  it("applies half-open author timestamp filters", () => {
    const row = ["hash1", "1000", "dev@example.com", "Dev", "subject"].join(UNIT);
    execFileSyncMock.mockReturnValue(`${row}\0`);
    expect(getCommits("/fake/repo", ["dev@example.com"], { from: 2000 })).toEqual([]);
    expect(getCommits("/fake/repo", ["dev@example.com"], { to: 1000 })).toEqual([]);
    expect(getCommits("/fake/repo", ["dev@example.com"], { from: 500, to: 1500 })).toEqual([
      {
        hash: "hash1",
        timestamp: 1000,
        email: "dev@example.com",
        name: "Dev",
        subject: "subject",
      },
    ]);
  });

  it("returns no authors when git log is empty", () => {
    execFileSyncMock.mockReturnValue("");
    expect(getAuthors("/fake/repo")).toEqual([]);
  });

  it("skips malformed and empty author rows", () => {
    execFileSyncMock.mockReturnValue("no-tab\0\tNoEmail\0dev@example.com\tDev\0");
    expect(getAuthors("/fake/repo")).toEqual([
      { email: "dev@example.com", name: "Dev", commits: 1 },
    ]);
  });
});
