// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import {
  getRepoConfig,
  loadConfig,
  repoCommitsDir,
  repoGroupsDir,
  setOllamaConfig,
  setRepoConfig,
} from "../lib/config.js";
import {resolveRepo} from "../lib/git.js";
import {aggregateDeterministic, groupByGap, loadCommitRecords, partitionTiers,} from "../lib/grouping.js";
import {enforceSignalReasons, groupClassifyJsonSchema, groupHistoryJsonSchema, type ModelLayer,} from "../lib/model.js";
import {chatJson, resolveBaseUrl} from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import { resolveModel } from "../lib/select.js";
import {
  buildGroupClassifyPrompt,
  buildGroupComposePrompt,
  GROUP_CLASSIFY_SYSTEM,
  GROUP_COMPOSE_SYSTEM,
  type GroupClassifyView,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import type {CommitRecord, GroupRecord} from "../lib/records.js";

/** Coerces an LLM-provided value into an array of non-empty strings. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_MAX_COMMITS = 20;

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
  /** Re-group and re-summarize, overwriting existing group files. */
  force?: boolean;
  /** Only process the first N groups that need summarizing (useful for trials). */
  limit?: number;
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
  const last = members[members.length - 1];
  if (!first || !last) throw new Error("Empty group");

  return {
    groupId: last.timestamp,
    timestampStart: first.timestamp,
    timestampEnd: last.timestamp,
    commitCount: members.length,
    groups: {
      commits: members.map((c) => c.commitHash),
      tiers: partitionTiers(members),
    },
    deterministic: aggregateDeterministic(members),
    model: null,
  };
}

/**
 * Groups a repository's commits into work sessions and summarizes each session
 * with a local Ollama model.
 * @param options - Resolved command options.
 */
export async function commitGroup(options: CommitGroupOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const commits = loadCommitRecords(repoCommitsDir(repoPath));
  if (commits.length === 0) {
    console.log(`No exported commits found for ${repoPath}. Run \`dev-workgraph export\` first.`);
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

  const groupsDir = repoGroupsDir(repoPath);
  fs.mkdirSync(groupsDir, { recursive: true });

  const sessions = groupByGap(commits, thresholdDays, maxCommits);
  console.log(
    `\n${commits.length} commit(s) → ${sessions.length} group(s) at ${thresholdDays}-day threshold` +
      `${maxCommits > 0 ? `, max ${maxCommits}/group` : ""}.`,
  );
  console.log(`Using model "${model}" at ${baseUrl}\n`);

  const projectBlock = projectContextBlock(loadProjectContext(repoPath));
  if (!projectBlock) {
    console.log("⚠️  No project context (run `dev-workgraph init`); grouping without it.\n");
  }
  const classifySystem = withProjectContext(projectBlock, GROUP_CLASSIFY_SYSTEM);
  const composeSystem = withProjectContext(projectBlock, GROUP_COMPOSE_SYSTEM);

  let summarized = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, members] of sessions.entries()) {
    const record = buildGroupRecord(members);
    const file = path.join(groupsDir, `${record.timestampEnd}.json`);

    if (!options.force && fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file, "utf8")) as GroupRecord;
      if (existing.model) {
        skipped += 1;
        continue;
      }
    }

    if (options.limit !== undefined && summarized + failed >= options.limit) {
      skipped += 1;
      continue;
    }

    const label = `[${i + 1}/${sessions.length}] group@${record.timestampEnd} (${record.commitCount} commits)`;
    process.stdout.write(`${label} ... `);

    try {
      // Stage 1 — classify signals + context tiers (no prose summary).
      const classifyPrompt = buildGroupClassifyPrompt(record, members);
      const rawClassify = (await chatJson({
        baseUrl,
        model,
        system: classifySystem,
        user: classifyPrompt.prompt,
        schema: groupClassifyJsonSchema(),
      })) as Record<string, unknown>;

      const { hiContext, mediumContext, lowContext, ...classifyFields } = rawClassify;
      const signals = enforceSignalReasons(classifyFields as unknown as ModelLayer);
      const tiers: GroupClassifyView = {
        technicalSignal: signals.technicalSignal,
        architectureSignal: signals.architectureSignal,
        securitySignal: signals.securitySignal,
        hiContext: asStringArray(hiContext),
        mediumContext: asStringArray(mediumContext),
        lowContext: asStringArray(lowContext),
      };

      // Stage 2 — merge the commit summaries into one HISTORY, weighted by tier.
      const composePrompt = buildGroupComposePrompt(record, tiers, members);
      const rawCompose = (await chatJson({
        baseUrl,
        model,
        system: composeSystem,
        user: composePrompt.prompt,
        schema: groupHistoryJsonSchema(),
      })) as { history?: string };

      const { summary: _omitSummary, ...signalFields } = signals;
      record.model = {
        ...signalFields,
        history: rawCompose.history ?? "",
        hiContext: tiers.hiContext,
        mediumContext: tiers.mediumContext,
        lowContext: tiers.lowContext,
        provenance: {
          model,
          generatedAt: new Date().toISOString(),
          patchTruncated: classifyPrompt.truncated || composePrompt.truncated,
        },
      };

      fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      console.log("ok");
      summarized += 1;
    } catch (err) {
      // Save the deterministic group so a later run can retry the model layer.
      fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      console.log(`failed (${(err as Error).message})`);
      failed += 1;
    }
  }

  console.log(
    `\n✅ Groups: ${sessions.length} · summarized ${summarized} · skipped ${skipped} · failed ${failed}.`,
  );
  console.log(`Written to ${groupsDir}`);
}