// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { repoProjectPath } from "./config.js";
import { writeRecordJson } from "./record-io.js";
import type { ProjectContext, ProjectTokenUsage, TokenTotals } from "./records.js";

/** Pipeline stages that invoke the LLM. */
export type PipelineStep =
  | "init"
  | "summarize"
  | "commit-group"
  | "report"
  | "prepare"
  | "final"
  | "deepen";

function emptyTotals(): TokenTotals {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}

function cloneTotals(t: TokenTotals): TokenTotals {
  return { ...t };
}

function cloneByModel(byModel: Record<string, TokenTotals>): Record<string, TokenTotals> {
  return Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, cloneTotals(v)]));
}

function addToTotals(target: TokenTotals, promptTokens: number, completionTokens: number): void {
  target.promptTokens += promptTokens;
  target.completionTokens += completionTokens;
  target.totalTokens += promptTokens + completionTokens;
  target.calls += 1;
}

function addToByModel(
  byModel: Record<string, TokenTotals>,
  model: string,
  promptTokens: number,
  completionTokens: number,
): void {
  const bucket = byModel[model] ?? emptyTotals();
  addToTotals(bucket, promptTokens, completionTokens);
  byModel[model] = bucket;
}

function subtractTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    promptTokens: a.promptTokens - b.promptTokens,
    completionTokens: a.completionTokens - b.completionTokens,
    totalTokens: a.totalTokens - b.totalTokens,
    calls: a.calls - b.calls,
  };
}

function subtractByModel(
  current: Record<string, TokenTotals>,
  start: Record<string, TokenTotals>,
): Record<string, TokenTotals> {
  const delta: Record<string, TokenTotals> = {};
  for (const model of new Set([...Object.keys(current), ...Object.keys(start)])) {
    const d = subtractTotals(current[model] ?? emptyTotals(), start[model] ?? emptyTotals());
    if (d.calls > 0) delta[model] = d;
  }
  return delta;
}

function formatTotals(t: TokenTotals): string {
  return (
    `prompt ${t.promptTokens.toLocaleString("en-US")} · ` +
    `output ${t.completionTokens.toLocaleString("en-US")} · ` +
    `total ${t.totalTokens.toLocaleString("en-US")} · ${t.calls} call${t.calls === 1 ? "" : "s"}`
  );
}

function logByModel(prefix: string, byModel: Record<string, TokenTotals>): void {
  const entries = Object.entries(byModel).filter(([, t]) => t.calls > 0);
  if (entries.length === 0) return;
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  for (const [model, t] of sorted) {
    process.stderr.write(`     ${prefix}${model} — ${formatTotals(t)}\n`);
  }
}

function emptyUsage(): ProjectTokenUsage {
  return {
    lifetime: { ...emptyTotals(), byModel: {} },
    steps: {},
  };
}

function loadUsageFromDisk(projectPath: string): ProjectTokenUsage {
  if (!fs.existsSync(projectPath)) return emptyUsage();
  try {
    const ctx = JSON.parse(fs.readFileSync(projectPath, "utf8")) as ProjectContext;
    if (!ctx.tokenUsage) return emptyUsage();
    return {
      lifetime: {
        ...emptyTotals(),
        ...ctx.tokenUsage.lifetime,
        byModel: { ...ctx.tokenUsage.lifetime?.byModel },
      },
      steps: { ...ctx.tokenUsage.steps },
    };
  } catch {
    return emptyUsage();
  }
}

/** Accumulates LLM token usage per pipeline step and persists to `project.json`. */
export class TokenUsageTracker {
  private readonly projectPath: string;
  private readonly usage: ProjectTokenUsage;
  private currentStep: PipelineStep | null = null;
  private runStartStep: TokenTotals | null = null;
  private runStartStepByModel: Record<string, TokenTotals> = {};

  constructor(repoPath: string, period?: string) {
    this.projectPath = repoProjectPath(repoPath, period);
    this.usage = loadUsageFromDisk(this.projectPath);
  }

  /** Active pipeline step label (for per-call logging). */
  get step(): PipelineStep | null {
    return this.currentStep;
  }

  beginStep(step: PipelineStep): void {
    this.currentStep = step;
    let stepUsage = this.usage.steps[step];
    if (!stepUsage) {
      stepUsage = { ...emptyTotals(), lastRunAt: "", byModel: {} };
      this.usage.steps[step] = stepUsage;
    }
    this.runStartStep = cloneTotals(stepUsage);
    this.runStartStepByModel = cloneByModel(stepUsage.byModel);
  }

  recordCall(opts: { model: string; promptTokens: number; completionTokens: number }): void {
    const { model, promptTokens, completionTokens } = opts;
    addToTotals(this.usage.lifetime, promptTokens, completionTokens);
    addToByModel(this.usage.lifetime.byModel, model, promptTokens, completionTokens);
    const stepKey = this.currentStep;
    if (!stepKey) return;
    const stepUsage = this.usage.steps[stepKey];
    if (!stepUsage) return;
    addToTotals(stepUsage, promptTokens, completionTokens);
    addToByModel(stepUsage.byModel, model, promptTokens, completionTokens);
  }

  /** Snapshot of accumulated usage (for embedding in a new `project.json`). */
  getUsage(): ProjectTokenUsage {
    return structuredClone(this.usage);
  }

  /**
   * Logs this-run vs lifetime totals and writes `tokenUsage` to `project.json`
   * when the file already exists.
   */
  endStep(opts?: { persist?: boolean }): void {
    if (!this.currentStep || !this.runStartStep) return;
    const step = this.currentStep;
    const stepUsage = this.usage.steps[step];
    if (!stepUsage) return;
    stepUsage.lastRunAt = new Date().toISOString();
    const runStep = subtractTotals(stepUsage, this.runStartStep);
    const runStepByModel = subtractByModel(stepUsage.byModel, this.runStartStepByModel);

    if (runStep.calls > 0) {
      process.stderr.write(`\n   tokens (${step}): this run — ${formatTotals(runStep)}\n`);
      logByModel("", runStepByModel);
      process.stderr.write(
        `   tokens (project): lifetime — ${formatTotals(this.usage.lifetime)}\n`,
      );
      logByModel("", this.usage.lifetime.byModel);
    }

    if (opts?.persist !== false) this.persist();

    this.currentStep = null;
    this.runStartStep = null;
    this.runStartStepByModel = {};
  }

  /** Merges `tokenUsage` into an existing `project.json`. */
  persist(): void {
    if (!fs.existsSync(this.projectPath)) return;
    try {
      const ctx = JSON.parse(fs.readFileSync(this.projectPath, "utf8")) as ProjectContext;
      ctx.tokenUsage = this.usage;
      writeRecordJson(this.projectPath, ctx);
    } catch {
      // leave project context intact on corrupt read
    }
  }
}

/** Logs one LLM call to stderr. */
export function logTokenCall(opts: {
  step: PipelineStep | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): void {
  const total = opts.promptTokens + opts.completionTokens;
  const step = opts.step ?? "?";
  process.stderr.write(
    `   llm · ${step} · ${opts.model} · ` +
      `prompt ${opts.promptTokens.toLocaleString("en-US")} · ` +
      `output ${opts.completionTokens.toLocaleString("en-US")} · ` +
      `total ${total.toLocaleString("en-US")}\n`,
  );
}
