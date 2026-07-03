// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import {
  getRepoConfig,
  loadConfig,
  repoCommitsDir,
  repoGroupsDir,
  repoSummariesDir,
  setOllamaConfig,
  setRepoConfig,
} from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import {
  aggregateDeterministic,
  coveredCommitHashes,
  extensionSessions,
  groupByGap,
  loadCommitRecords,
  partitionTiers,
} from "../lib/grouping.js";
import {
  cleanQuestionAnalyses,
  enforceSignalReasons,
  groupClassifyJsonSchema,
  groupHistoryJsonSchema,
  isEmptyCommitSummary,
  type ModelLayer,
  mergeTechnologies,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildGroupClassifyPrompt,
  buildGroupComposePrompt,
  GROUP_CLASSIFY_SYSTEM,
  GROUP_COMPOSE_SYSTEM,
  type GroupClassifyView,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type { CommitRecord, GroupRecord } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/** Coerces an LLM-provided value into an array of non-empty strings. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_MAX_COMMITS = 20;

interface GroupingSummaryInput {
  commitCount: number;
  groupingCount: number;
  emptySkipped: number;
  sessionCount: number;
  thresholdDays: number;
  maxCommits: number;
  fullyCovered: number;
  pendingCount: number;
}

function formatGroupingSummary(input: GroupingSummaryInput): string {
  const {
    commitCount,
    groupingCount,
    emptySkipped,
    sessionCount,
    thresholdDays,
    maxCommits,
    fullyCovered,
    pendingCount,
  } = input;
  const parts = [`\n${commitCount} commit(s)`];
  if (emptySkipped > 0) {
    parts.push(
      ` → ${groupingCount} for grouping (${emptySkipped} empty summar${emptySkipped === 1 ? "y" : "ies"} skipped)`,
    );
  }
  parts.push(` → ${sessionCount} session(s) at ${thresholdDays}-day threshold`);
  if (maxCommits > 0) parts.push(`, max ${maxCommits}/group`);
  if (fullyCovered > 0) parts.push(` · ${fullyCovered} fully covered`);
  if (pendingCount > 0) parts.push(` · ${pendingCount} to summarize`);
  return `${parts.join("")}.`;
}

/**
 * Options for the `commit-group` command.
 */
export interface CommitGroupOptions {
  /** Path to the repository. */
  repo: string;
  /** Days between commits before a new group starts; skips the prompt. */
  days?: number;
  /** Max commits per group (0 = unlimited); skips the prompt. */
  maxCommits?: number;
  /** Ollama base URL override. */
  url?: string;
  /** Model name; skips the interactive picker. */
  model?: string;
  /** Only process the first N groups that need summarizing (useful for trials). */
  limit?: number;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

/**
 * Resolves the grouping threshold in days: the flag, else an interactive prompt
 * seeded from the saved value, else the default. Persists the resolved value.
 * @param repoPath - Absolute repository path.
 * @param flagDays - Value of `--days`, if any.
 */
async function resolveThreshold(repoPath: string, flagDays?: number): Promise<number> {
  if (flagDays !== undefined && Number.isFinite(flagDays) && flagDays > 0) {
    setRepoConfig(repoPath, { groupThresholdDays: flagDays });
    return flagDays;
  }
  const saved = getRepoConfig(repoPath)?.groupThresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  const { days } = await inquirer.prompt<{ days: number }>([
    {
      type: "number",
      name: "days",
      message: "Max days between commits before a new work-session group starts:",
      default: saved,
    },
  ]);
  const value = Number.isFinite(days) && days > 0 ? days : saved;
  setRepoConfig(repoPath, { groupThresholdDays: value });
  return value;
}

/**
 * Resolves the max commits per group: the flag, else an interactive prompt
 * seeded from the saved value, else the default. Persists the resolved value.
 * 0 means unlimited.
 * @param repoPath - Absolute repository path.
 * @param flagMax - Value of `--max-commits`, if any.
 */
async function resolveMaxCommits(repoPath: string, flagMax?: number): Promise<number> {
  if (flagMax !== undefined && Number.isFinite(flagMax) && flagMax >= 0) {
    setRepoConfig(repoPath, { groupMaxCommits: flagMax });
    return flagMax;
  }
  const saved = getRepoConfig(repoPath)?.groupMaxCommits ?? DEFAULT_MAX_COMMITS;
  const { maxCommits } = await inquirer.prompt<{ maxCommits: number }>([
    {
      type: "number",
      name: "maxCommits",
      message: "Max commits per group (0 = unlimited):",
      default: saved,
    },
  ]);
  const value = Number.isFinite(maxCommits) && maxCommits >= 0 ? maxCommits : saved;
  setRepoConfig(repoPath, { groupMaxCommits: value });
  return value;
}

/**
 * Builds the deterministic part of a group record (everything except `model`).
 * @param members - Member commit records, oldest first.
 */
function buildGroupRecord(members: CommitRecord[]): GroupRecord {
  const first = members[0];
  const last = members.at(-1);
  if (!first || !last) throw new Error("Empty group");

  return {
    groupId: last.timestamp,
    timestampStart: first.timestamp,
    timestampEnd: last.timestamp,
    commitCount: members.length,
    groups: {
      commits: members.map((c) => c.commitHash),
      tiers: partitionTiers(members),
      sourceEvidence: members.map((c) => c.sourceEvidence),
      sourceSummaries: members.map((c) => c.sourceSummary),
    },
    deterministic: aggregateDeterministic(members),
    model: null,
  };
}

interface GroupSummarizeContext {
  baseUrl: string;
  model: string;
  classifySystem: string;
  composeSystem: string;
  tracker: TokenUsageTracker;
}

/** Skips groups that already have a model layer or exceed the trial limit. */
function groupSkipReason(
  file: string,
  limit: number | undefined,
  summarized: number,
  failed: number,
): "already-done" | "limit" | null {
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8")) as GroupRecord;
    if (existing.model) return "already-done";
  }
  if (limit !== undefined && summarized + failed >= limit) return "limit";
  return null;
}

/** Runs the two-stage LLM summarize for one work session. */
async function summarizeGroupSession(
  record: GroupRecord,
  members: CommitRecord[],
  ctx: GroupSummarizeContext,
): Promise<GroupRecord> {
  const classifyPrompt = buildGroupClassifyPrompt(record, members);
  const rawClassify = (await chatJson({
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    system: ctx.classifySystem,
    user: classifyPrompt,
    schema: groupClassifyJsonSchema(),
    think: false,
    tracker: ctx.tracker,
  })) as Record<string, unknown>;

  const { hiContext, mediumContext, lowContext, questionsAnalyses, ...classifyFields } =
    rawClassify;
  const signals = enforceSignalReasons(classifyFields as unknown as ModelLayer);
  const tiers: GroupClassifyView = {
    technicalSignal: signals.technicalSignal,
    architectureSignal: signals.architectureSignal,
    securitySignal: signals.securitySignal,
    hiContext: asStringArray(hiContext),
    mediumContext: asStringArray(mediumContext),
    lowContext: asStringArray(lowContext),
  };

  const composePrompt = buildGroupComposePrompt(record, tiers, members);
  const rawCompose = (await chatJson({
    baseUrl: ctx.baseUrl,
    model: ctx.model,
    system: ctx.composeSystem,
    user: composePrompt,
    schema: groupHistoryJsonSchema(),
    think: false,
    tracker: ctx.tracker,
  })) as { history?: string };

  const { summary: _omitSummary, ...signalFields } = signals;
  return {
    ...record,
    model: {
      ...signalFields,
      technologies: mergeTechnologies(...members.map((m) => m.model?.technologies)),
      history: rawCompose.history ?? "",
      hiContext: tiers.hiContext,
      mediumContext: tiers.mediumContext,
      lowContext: tiers.lowContext,
      questionsAnalyses: cleanQuestionAnalyses(questionsAnalyses),
      provenance: {
        model: ctx.model,
        generatedAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * Groups a repository's commits into work sessions and summarizes each session
 * with a local Ollama model.
 * @param options - Resolved command options.
 */
export async function commitGroup(options: CommitGroupOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const allCommits = loadCommitRecords(
    repoCommitsDir(repoPath, options.period),
    repoSummariesDir(repoPath, options.period),
  );
  if (allCommits.length === 0) {
    console.log(`No exported commits found for ${repoPath}. Run \`dev-workgraph evidence\` first.`);
    return;
  }

  const commits = allCommits.filter((c) => !isEmptyCommitSummary(c.model));
  const emptySkipped = allCommits.length - commits.length;
  if (commits.length === 0) {
    console.log(
      `No commits to group for ${repoPath} (${emptySkipped} empty summar${emptySkipped === 1 ? "y" : "ies"} skipped).`,
    );
    return;
  }

  const thresholdDays = await resolveThreshold(repoPath, options.days);
  const maxCommits = await resolveMaxCommits(repoPath, options.maxCommits);
  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should summarize work sessions?",
    saved: savedOllama?.commitModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, commitModel: model });

  const groupsDir = repoGroupsDir(repoPath, options.period);
  fs.mkdirSync(groupsDir, { recursive: true });

  const rawSessions = groupByGap(commits, thresholdDays, maxCommits);
  const covered = coveredCommitHashes(groupsDir);
  const sessions = extensionSessions(rawSessions, covered);
  const fullyCovered = rawSessions.length - sessions.length;
  console.log(
    formatGroupingSummary({
      commitCount: allCommits.length,
      groupingCount: commits.length,
      emptySkipped,
      sessionCount: rawSessions.length,
      thresholdDays,
      maxCommits,
      fullyCovered,
      pendingCount: sessions.length,
    }),
  );
  console.log(`Using model "${model}" at ${baseUrl}\n`);

  const projectBlock = projectContextBlock(loadProjectContext(repoPath, options.period));
  if (!projectBlock) {
    console.log("⚠️  No project context (run `dev-workgraph init`); grouping without it.\n");
  }
  const classifySystem = withProjectContext(projectBlock, GROUP_CLASSIFY_SYSTEM);
  const composeSystem = withProjectContext(projectBlock, GROUP_COMPOSE_SYSTEM);

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("commit-group");

  const summarizeCtx: GroupSummarizeContext = {
    baseUrl,
    model,
    classifySystem,
    composeSystem,
    tracker,
  };

  let summarized = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const [i, members] of sessions.entries()) {
      const record = buildGroupRecord(members);
      const file = path.join(groupsDir, `${record.timestampEnd}.json`);

      const skip = groupSkipReason(file, options.limit, summarized, failed);
      if (skip === "already-done" || skip === "limit") {
        skipped += 1;
        continue;
      }

      const label = `[${i + 1}/${sessions.length}] group@${record.timestampEnd} (${record.commitCount} commits)`;
      process.stdout.write(`${label} ... `);

      try {
        const summarizedRecord = await summarizeGroupSession(record, members, summarizeCtx);
        writeRecordJson(file, summarizedRecord);
        for (const c of members) covered.add(c.commitHash);
        console.log("ok");
        summarized += 1;
      } catch (err) {
        writeRecordJson(file, record);
        console.log(`failed (${(err as Error).message})`);
        failed += 1;
      }
    }
  } finally {
    tracker.endStep();
  }

  console.log(
    `\n✅ Groups: ${rawSessions.length} · summarized ${summarized} · skipped ${skipped + fullyCovered} · failed ${failed}.`,
  );
  console.log(`Written to ${groupsDir}`);
}
