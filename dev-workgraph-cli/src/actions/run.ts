// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import inquirer from "inquirer";
import { getRepoConfig, repoProjectPath, setRepoConfig } from "../lib/config.js";
import { currentUserEmail, getAuthors, resolveRepo } from "../lib/git.js";
import type { LlmCommandOptions } from "../lib/llm/cli-options.js";
import type { LlmModelChoice } from "../lib/llm/types.js";
import { withProviderStep } from "../lib/lmstudio-session.js";
import { discoverLlmBackends, noLlmBackendsError, providerLabel } from "../lib/ollama.js";
import { resolvePeriodDefinition } from "../lib/periods.js";
import { resolveLlmSlot } from "../lib/select.js";
import { llmReady } from "./check.js";
import { commitGroup } from "./commit-group.js";
import { evidence } from "./evidence.js";
import { final } from "./final.js";
import { init, resolveRole, resolveStory } from "./init.js";
import { prepare } from "./prepare.js";
import { report } from "./report.js";
import { summarize } from "./summarize.js";

/**
 * Options for the `run` command (the whole-pipeline orchestrator).
 */
export interface RunOptions extends LlmCommandOptions {
  /** Path to the repository. */
  repo: string;
  /** Review-period label to scope the whole pipeline under. */
  period?: string;
  /** Period start date, ISO `YYYY-MM-DD` (defines/updates the period). */
  from?: string;
  /** Period end date, ISO `YYYY-MM-DD` (defines/updates the period). */
  to?: string;
  /** Force period mode even when no `--period` was given (prompts for it). */
  periodMode?: boolean;
}

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_MAX_COMMITS = 20;

interface RunSlots {
  commit: LlmModelChoice;
  report: LlmModelChoice;
  narrative: LlmModelChoice;
}

interface RunGroupSettings {
  days: number;
  maxCommits: number;
}

interface RunInitContext {
  needInit: boolean;
  role?: string;
  story?: string;
}

/** Interactive author selection (checkbox), pre-checking the repo's git identity. */
async function selectAuthors(repoPath: string): Promise<string[]> {
  const all = getAuthors(repoPath);
  if (all.length === 0) return [];
  const me = currentUserEmail(repoPath)?.toLowerCase();
  const { picked } = await inquirer.prompt<{ picked: string[] }>([
    {
      type: "checkbox",
      name: "picked",
      message: "Select the author identities that are YOUR work:",
      pageSize: 20,
      choices: all.map((a) => ({
        name: `${a.name} <${a.email}>  (${a.commits} commit${a.commits === 1 ? "" : "s"})`,
        value: a.email,
        checked: a.email === me,
      })),
    },
  ]);
  return picked;
}

async function resolveRunPeriod(
  repoPath: string,
  options: RunOptions,
): Promise<string | undefined> {
  if (!options.periodMode && !options.period && !options.from && !options.to) return undefined;
  const resolved = await resolvePeriodDefinition({
    repoPath,
    id: options.period,
    from: options.from,
    to: options.to,
  });
  console.log(`Review period "${resolved.id}": ${resolved.period.from} → ${resolved.period.to}\n`);
  return resolved.id;
}

async function resolveRunSlots(options: RunOptions): Promise<RunSlots> {
  const shared = {
    ollama: options.ollama,
    lmstudio: options.lmstudio,
    model: options.model?.trim() || undefined,
  };

  const backends = await discoverLlmBackends(shared);
  if (backends.length === 0) {
    throw noLlmBackendsError();
  }

  console.log(
    "\nSelect a model for each pipeline stage (Ollama and LM Studio models appear together).\n",
  );

  const commit = await resolveLlmSlot("commit", {
    ...shared,
    message: "Model for commit summaries & commit-group?",
  });
  const reportSlot = await resolveLlmSlot("report", {
    ...shared,
    message: "Model for report?",
  });
  const narrative = await resolveLlmSlot("narrative", {
    ...shared,
    message: "Model for project context (init), prepare & final?",
  });
  return { commit, report: reportSlot, narrative };
}

async function ensureBackendsReady(slots: RunSlots): Promise<void> {
  const seen = new Set<string>();
  for (const slot of [slots.commit, slots.report, slots.narrative]) {
    const key = `${slot.providerId}\0${slot.baseUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = providerLabel(slot.providerId);
    console.log(`Checking ${label} at ${slot.baseUrl} ...`);
    if (!(await llmReady(slot.baseUrl, slot.providerId))) {
      throw new Error(`LLM backend ${label} is not ready (see above). Fix it, then re-run.`);
    }
  }
}

async function resolveRunInitContext(
  repoPath: string,
  period: string | undefined,
): Promise<RunInitContext> {
  const projectExists = fs.existsSync(repoProjectPath(repoPath, period));
  const needInit = !projectExists;
  const needRoleStory = needInit && !period;
  if (!needRoleStory) {
    if (needInit && period) {
      console.log(`Period "${period}" will inherit the repo-level project context.`);
    } else {
      console.log("Project already initialized — keeping existing context.");
    }
    return { needInit };
  }
  const role = await resolveRole();
  const story = await resolveStory();
  return { needInit, role, story };
}

async function resolveRunAuthors(repoPath: string): Promise<string[]> {
  const cfg = getRepoConfig(repoPath);
  const saved = cfg?.selectedAuthors ?? [];
  if (saved.length > 0) {
    console.log(`Using saved authors: ${saved.join(", ")}`);
    return saved;
  }
  const emails = await selectAuthors(repoPath);
  if (emails.length === 0) throw new Error("No author identities selected.");
  setRepoConfig(repoPath, { selectedAuthors: emails });
  return emails;
}

async function resolveRunGroupSettings(repoPath: string): Promise<RunGroupSettings> {
  const cfg = getRepoConfig(repoPath);
  let days = cfg?.groupThresholdDays;
  if (days === undefined) {
    const answer = await inquirer.prompt<{ days: number }>([
      {
        type: "number",
        name: "days",
        message: "Max days between commits before a new work-session group starts:",
        default: days ?? DEFAULT_THRESHOLD_DAYS,
      },
    ]);
    days = Number.isFinite(answer.days) && answer.days > 0 ? answer.days : DEFAULT_THRESHOLD_DAYS;
    setRepoConfig(repoPath, { groupThresholdDays: days });
  } else {
    console.log(`Using saved group threshold: ${days} day(s)`);
  }

  let maxCommits = cfg?.groupMaxCommits;
  if (maxCommits === undefined) {
    const answer = await inquirer.prompt<{ maxCommits: number }>([
      {
        type: "number",
        name: "maxCommits",
        message: "Max commits per group (0 = unlimited):",
        default: maxCommits ?? DEFAULT_MAX_COMMITS,
      },
    ]);
    maxCommits =
      Number.isFinite(answer.maxCommits) && answer.maxCommits >= 0
        ? answer.maxCommits
        : DEFAULT_MAX_COMMITS;
    setRepoConfig(repoPath, { groupMaxCommits: maxCommits });
  } else {
    console.log(`Using saved max commits/group: ${maxCommits || "unlimited"}`);
  }
  return { days, maxCommits };
}

/**
 * Runs the whole pipeline after gathering every upfront input: init → evidence →
 * summarize → commit-group → report → prepare run unattended; `final` then asks
 * the prepared questions interactively (they can't be gathered before prepare).
 * @param options - Resolved command options.
 */
export async function run(options: RunOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);

  console.log("=== dev-workgraph run — gathering inputs ===\n");

  const period = await resolveRunPeriod(repoPath, options);
  const slots = await resolveRunSlots(options);
  await ensureBackendsReady(slots);

  const initCtx = await resolveRunInitContext(repoPath, period);
  const emails = await resolveRunAuthors(repoPath);
  const groupSettings = await resolveRunGroupSettings(repoPath);

  console.log("\n=== Running pipeline (final will ask the prepared questions at the end) ===");

  if (initCtx.needInit) {
    console.log("\n[1/7] init");
    await withProviderStep(slots.narrative, () =>
      init({
        repo: repoPath,
        role: initCtx.role,
        story: initCtx.story,
        model: slots.narrative.model,
        period,
      }),
    );
  } else {
    console.log("\n[1/7] init — skipped (already initialized)");
  }

  console.log("\n[2/7] evidence");
  await withProviderStep(slots.commit, () =>
    evidence({
      repo: repoPath,
      email: emails,
      period,
      model: slots.commit.model,
    }),
  );

  console.log("\n[3/7] summarize");
  await withProviderStep(slots.commit, () =>
    summarize({
      repo: repoPath,
      model: slots.commit.model,
      period,
    }),
  );

  console.log("\n[4/7] commit-group");
  await withProviderStep(slots.commit, () =>
    commitGroup({
      repo: repoPath,
      model: slots.commit.model,
      days: groupSettings.days,
      maxCommits: groupSettings.maxCommits,
      period,
    }),
  );

  console.log("\n[5/7] report");
  await withProviderStep(slots.report, () =>
    report({
      repo: repoPath,
      model: slots.report.model,
      period,
    }),
  );

  console.log("\n[6/7] prepare");
  await withProviderStep(slots.narrative, () =>
    prepare({
      repo: repoPath,
      model: slots.narrative.model,
      period,
    }),
  );

  console.log("\n[7/7] final");
  await withProviderStep(slots.narrative, () =>
    final({
      repo: repoPath,
      model: slots.narrative.model,
      period,
    }),
  );

  console.log("\n✅ Pipeline complete.");
}
