import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoProjectPath } from "../../../src/lib/config.js";
import type { ProjectContext } from "../../../src/lib/records.js";
import { logTokenCall, TokenUsageTracker } from "../../../src/lib/token-usage.js";

const repo = path.resolve("/tmp/token-usage-repo");

function minimalProject(overrides?: Partial<ProjectContext>): ProjectContext {
  return {
    role: "Senior Developer",
    profile: {
      summary: "CLI",
      domains: [],
      apparentStack: [],
      keyThemes: [],
    },
    story: { raw: "", preparedContext: "" },
    readme: { present: false },
    provenance: { model: "test", generatedAt: "2026-01-01T00:00:00Z" },
    ...overrides,
  };
}

function writeProject(file: string, ctx: ProjectContext): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ctx));
}

describe("logTokenCall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs step, model, and token counts", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logTokenCall({
      step: "summarize",
      model: "alpha",
      promptTokens: 1200,
      completionTokens: 80,
    });
    expect(stderr).toHaveBeenCalledWith(
      "   llm · summarize · alpha · prompt 1,200 · output 80 · total 1,280\n",
    );
  });

  it("uses ? when step is null", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logTokenCall({ step: null, model: "beta", promptTokens: 0, completionTokens: 0 });
    expect(stderr).toHaveBeenCalledWith("   llm · ? · beta · prompt 0 · output 0 · total 0\n");
  });
});

describe("TokenUsageTracker", () => {
  let tmpHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-tokens-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("accumulates usage by step and model, then persists to project.json", () => {
    const file = repoProjectPath(repo);
    writeProject(file, minimalProject());

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("summarize");
    tracker.recordCall({ model: "alpha", promptTokens: 100, completionTokens: 20 });
    tracker.recordCall({ model: "beta", promptTokens: 50, completionTokens: 10 });
    tracker.endStep({ persist: true });

    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
    expect(saved.tokenUsage?.lifetime.promptTokens).toBe(150);
    expect(saved.tokenUsage?.lifetime.completionTokens).toBe(30);
    expect(saved.tokenUsage?.lifetime.calls).toBe(2);
    expect(saved.tokenUsage?.lifetime.byModel.alpha?.promptTokens).toBe(100);
    expect(saved.tokenUsage?.steps.summarize?.calls).toBe(2);
    expect(saved.tokenUsage?.steps.summarize?.byModel.beta?.totalTokens).toBe(60);
    expect(saved.tokenUsage?.steps.summarize?.lastRunAt).toBeTruthy();
  });

  it("loads existing tokenUsage from disk", () => {
    const file = repoProjectPath(repo);
    writeProject(
      file,
      minimalProject({
        tokenUsage: {
          lifetime: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            calls: 1,
            byModel: { alpha: { promptTokens: 10, completionTokens: 5, totalTokens: 15, calls: 1 } },
          },
          steps: {
            init: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
              calls: 1,
              lastRunAt: "2026-01-01T00:00:00Z",
              byModel: { alpha: { promptTokens: 10, completionTokens: 5, totalTokens: 15, calls: 1 } },
            },
          },
        },
      }),
    );

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("report");
    tracker.recordCall({ model: "beta", promptTokens: 40, completionTokens: 8 });
    tracker.endStep();

    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
    expect(saved.tokenUsage?.lifetime.promptTokens).toBe(50);
    expect(saved.tokenUsage?.steps.init?.calls).toBe(1);
    expect(saved.tokenUsage?.steps.report?.calls).toBe(1);
  });

  it("exposes the active step via getter", () => {
    const tracker = new TokenUsageTracker(repo);
    expect(tracker.step).toBeNull();
    tracker.beginStep("prepare");
    expect(tracker.step).toBe("prepare");
    tracker.endStep({ persist: false });
    expect(tracker.step).toBeNull();
  });

  it("records lifetime usage even without beginStep", () => {
    const tracker = new TokenUsageTracker(repo);
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    const usage = tracker.getUsage();
    expect(usage.lifetime.promptTokens).toBe(10);
    expect(usage.lifetime.calls).toBe(1);
    expect(usage.steps).toEqual({});
  });

  it("getUsage returns a snapshot that does not alias internal state", () => {
    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    const snapshot = tracker.getUsage();
    snapshot.lifetime.promptTokens = 999;
    expect(tracker.getUsage().lifetime.promptTokens).toBe(10);
  });

  it("skips stderr summary when the step records no new calls", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("final");
    tracker.endStep({ persist: false });
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("tokens (final)"));
  });

  it("logs per-run delta on endStep when calls were recorded", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("report");
    tracker.recordCall({ model: "beta", promptTokens: 40, completionTokens: 8 });
    tracker.endStep({ persist: false });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("tokens (report): this run — prompt 40 · output 8 · total 48 · 1 call"),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("tokens (project): lifetime — prompt 40 · output 8 · total 48 · 1 call"),
    );
    expect(stderr).toHaveBeenCalledWith("     beta — prompt 40 · output 8 · total 48 · 1 call\n");
  });

  it("logs only this-run delta when the same step runs again", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("summarize");
    tracker.recordCall({ model: "alpha", promptTokens: 100, completionTokens: 20 });
    tracker.endStep({ persist: false });
    stderr.mockClear();

    tracker.beginStep("summarize");
    tracker.recordCall({ model: "alpha", promptTokens: 50, completionTokens: 10 });
    tracker.endStep({ persist: false });

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("tokens (summarize): this run — prompt 50 · output 10 · total 60 · 1 call"),
    );
    expect(tracker.getUsage().steps.summarize?.promptTokens).toBe(150);
  });

  it("endStep with persist: false does not write project.json", () => {
    const file = repoProjectPath(repo);
    writeProject(file, minimalProject());
    const before = fs.readFileSync(file, "utf8");

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep({ persist: false });

    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(tracker.getUsage().lifetime.promptTokens).toBe(10);
  });

  it("starts with empty usage when project.json is missing", () => {
    const file = repoProjectPath(repo);
    expect(fs.existsSync(file)).toBe(false);

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep({ persist: true });

    expect(fs.existsSync(file)).toBe(false);
    expect(tracker.getUsage().lifetime.promptTokens).toBe(10);
  });

  it("starts with empty usage when project.json has no tokenUsage", () => {
    const file = repoProjectPath(repo);
    writeProject(file, minimalProject());

    const tracker = new TokenUsageTracker(repo);
    expect(tracker.getUsage().lifetime.calls).toBe(0);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep();
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
    expect(saved.tokenUsage?.lifetime.calls).toBe(1);
  });

  it("starts with empty usage when project.json is corrupt", () => {
    const file = repoProjectPath(repo);
    writeProject(file, minimalProject());
    fs.writeFileSync(file, "{not json");

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep({ persist: false });
    expect(tracker.getUsage().lifetime.promptTokens).toBe(10);
  });

  it("persist leaves corrupt project.json intact", () => {
    const file = repoProjectPath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");

    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.persist();

    expect(fs.readFileSync(file, "utf8")).toBe("{not json");
  });

  it("accumulates multiple steps in one tracker session", () => {
    const tracker = new TokenUsageTracker(repo);
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep({ persist: false });

    tracker.beginStep("summarize");
    tracker.recordCall({ model: "beta", promptTokens: 20, completionTokens: 4 });
    tracker.endStep({ persist: false });

    const usage = tracker.getUsage();
    expect(usage.lifetime.promptTokens).toBe(30);
    expect(usage.lifetime.calls).toBe(2);
    expect(usage.steps.init?.calls).toBe(1);
    expect(usage.steps.summarize?.calls).toBe(1);
  });

  it("uses period-specific project.json path", () => {
    const file = repoProjectPath(repo, "2022");
    writeProject(file, minimalProject());

    const tracker = new TokenUsageTracker(repo, "2022");
    tracker.beginStep("init");
    tracker.recordCall({ model: "alpha", promptTokens: 10, completionTokens: 5 });
    tracker.endStep();

    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
    expect(saved.tokenUsage?.steps.init?.calls).toBe(1);
    expect(fs.existsSync(repoProjectPath(repo))).toBe(false);
  });
});
