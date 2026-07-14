import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPeriod } from "../../../src/lib/config.js";
import { resolvePeriodDefinition, resolvePeriodRange } from "../../../src/lib/periods.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

describe("resolvePeriodRange", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  const repo = "/tmp/period-repo";

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-period-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
    setPeriod(repo, "2022", { from: "2022-01-01", to: "2023-01-01" });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("converts configured ISO dates to epoch seconds", () => {
    const range = resolvePeriodRange(repo, "2022");
    expect(range.from).toBe(Math.floor(Date.parse("2022-01-01T00:00:00Z") / 1000));
    expect(range.to).toBe(Math.floor(Date.parse("2023-01-01T00:00:00Z") / 1000));
  });

  it("throws when the period is undefined", () => {
    expect(() => resolvePeriodRange(repo, "missing")).toThrow(/not defined/i);
  });

  it("throws when period dates are invalid", () => {
    setPeriod(repo, "bad-dates", { from: "2022-02-30", to: "2023-01-01" });
    expect(() => resolvePeriodRange(repo, "bad-dates")).toThrow(/invalid dates/i);
  });

  it("throws when to is not after from", () => {
    setPeriod(repo, "inverted", { from: "2023-01-01", to: "2022-01-01" });
    expect(() => resolvePeriodRange(repo, "inverted")).toThrow(/must have to/i);
  });
});

describe("resolvePeriodDefinition", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  const repo = "/tmp/period-def-repo";

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-period-def-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
    promptMock.mockReset();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reuses an existing period when only id is provided", async () => {
    setPeriod(repo, "2022-H1", { from: "2022-01-01", to: "2022-07-01" });
    const resolved = await resolvePeriodDefinition({ repoPath: repo, id: "2022-H1" });
    expect(resolved).toEqual({
      id: "2022-H1",
      period: { from: "2022-01-01", to: "2022-07-01" },
    });
  });

  it("persists a new period from flags", async () => {
    const resolved = await resolvePeriodDefinition({
      repoPath: repo,
      id: "2023",
      from: "2023-01-01",
      to: "2024-01-01",
    });
    expect(resolved.period).toEqual({ from: "2023-01-01", to: "2024-01-01" });
  });

  it("rejects invalid flag dates", async () => {
    await expect(
      resolvePeriodDefinition({
        repoPath: repo,
        id: "bad",
        from: "2023-02-30",
        to: "2024-01-01",
      }),
    ).rejects.toThrow(/invalid date/i);
  });

  it("rejects when to is not after from", async () => {
    await expect(
      resolvePeriodDefinition({
        repoPath: repo,
        id: "2024",
        from: "2024-06-01",
        to: "2024-01-01",
      }),
    ).rejects.toThrow(/must be after/i);
  });

  it("rejects invalid period labels", async () => {
    await expect(
      resolvePeriodDefinition({
        repoPath: repo,
        id: "../escape",
        from: "2024-01-01",
        to: "2025-01-01",
      }),
    ).rejects.toThrow(/invalid period label/i);
  });

  it("prompts for period id and dates when flags are omitted", async () => {
    promptMock
      .mockResolvedValueOnce({ id: "2026" })
      .mockResolvedValueOnce({ date: "2026-01-01" })
      .mockResolvedValueOnce({ date: "2027-01-01" });
    const resolved = await resolvePeriodDefinition({ repoPath: repo });
    expect(resolved).toEqual({
      id: "2026",
      period: { from: "2026-01-01", to: "2027-01-01" },
    });
    expect(promptMock).toHaveBeenCalledTimes(3);
  });

  it("prompts only for the end date when the start date is provided", async () => {
    promptMock.mockResolvedValueOnce({ date: "2025-01-01" });
    const resolved = await resolvePeriodDefinition({
      repoPath: repo,
      id: "fresh",
      from: "2024-01-01",
    });
    expect(resolved.period).toEqual({ from: "2024-01-01", to: "2025-01-01" });
    expect(promptMock).toHaveBeenCalledTimes(1);
  });
});
