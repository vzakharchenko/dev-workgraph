// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { type CommitGroupRunContext, getCommitGroupStrategy } from "../lib/commit-group/index.js";
import { repoCommitsDir, repoGroupsDir, repoSummariesDir } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { aggregateDeterministic, loadCommitRecords, partitionTiers } from "../lib/grouping.js";
import type { LlmCommandOptions } from "../lib/llm/cli-options.js";
import type { LlmProviderId } from "../lib/llm/types.js";
import {
  cleanQuestionAnalyses,
  enforceSignalReasons,
  groupClassifyJsonSchema,
  groupHistoryJsonSchema,
  isEmptyCommitSummary,
  type ModelLayer,
  mergeTechnologies,
} from "../lib/model.js";
import { chatJson } from "../lib/ollama.js";
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
import { resolveLlmSlot } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/** Coerces an LLM-provided value into an array of non-empty strings. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

/**
 * Options for the `commit-group` command.
 */
export interface CommitGroupOptions extends LlmCommandOptions {
  /** Path to the repository. */
  repo: string;
  /** Only process the first N groups that need summarizing (useful for trials). */
  limit?: number;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
  /** Grouping strategy id (default: first registered). */
  groupStrategy?: string;
  /** Strategy-specific CLI flags parsed by {@link pickCommitGroupStrategyOptions}. */
  strategyCli?: Record<string, unknown>;
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
  provider: LlmProviderId;
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
    provider: ctx.provider,
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
    provider: ctx.provider,
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
 * with a local LLM.
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

  const groupsDir = repoGroupsDir(repoPath, options.period);
  fs.mkdirSync(groupsDir, { recursive: true });

  const runCtx: CommitGroupRunContext = {
    repoPath,
    period: options.period,
    groupsDir,
    commits,
    allCommitCount: allCommits.length,
    emptySkipped,
    options: {
      limit: options.limit,
      period: options.period,
      strategyCli: options.strategyCli ?? {},
    },
  };

  const strategy = getCommitGroupStrategy(options.groupStrategy);

  const init = await strategy.init(runCtx);
  const partition = await strategy.partition(commits, init, runCtx);

  const { providerId, baseUrl, model } = await resolveLlmSlot("commit", {
    ollama: options.ollama,
    lmstudio: options.lmstudio,
    model: options.model,
    message: "Which model should summarize work sessions?",
  });

  console.log(strategy.formatSummary(runCtx, init, partition));
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
    provider: providerId,
    classifySystem,
    composeSystem,
    tracker,
  };

  const covered = new Set<string>();
  let summarized = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const [i, bucket] of partition.buckets.entries()) {
      const { members, fileKey } = bucket;
      const record = buildGroupRecord(members);
      const file = path.join(groupsDir, `${fileKey}.json`);

      const skip = groupSkipReason(file, options.limit, summarized, failed);
      if (skip === "already-done" || skip === "limit") {
        skipped += 1;
        continue;
      }

      const label = `[${i + 1}/${partition.buckets.length}] group@${record.timestampEnd} (${record.commitCount} commits)`;
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
    `\n✅ Groups: ${partition.stats.rawBucketCount} · summarized ${summarized} · skipped ${skipped + partition.stats.fullyCovered} · failed ${failed}.`,
  );
  console.log(`Written to ${groupsDir}`);
}
