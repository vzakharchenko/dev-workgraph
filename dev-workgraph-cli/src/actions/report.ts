// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { loadConfig, repoGroupsDir, repoReportsDir, setOllamaConfig } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { loadGroupRecords, mergeDeterministic } from "../lib/grouping.js";
import {
  cleanQuestionAnalyses,
  maxSignal,
  mergeTechnologies,
  reportHistoryJsonSchema,
  reportMergeJsonSchema,
  reportNewHistoryJsonSchema,
  routineCheckJsonSchema,
  type Signal,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildReportCompactPrompt,
  buildReportMergePrompt,
  buildReportNewHistoryPrompt,
  buildRoutineCheckPrompt,
  MAX_CONTEXT_BULLETS,
  MAX_HISTORY_ENTRIES,
  projectContextBlock,
  REPORT_COMPACT_SYSTEM,
  REPORT_MERGE_SYSTEM,
  REPORT_NEW_HISTORY_SYSTEM,
  ROUTINE_CHECK_SYSTEM,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type {
  GroupRecord,
  ReportHistoryEntry,
  ReportModelLayer,
  ReportRecord,
} from "../lib/records.js";
import {
  buildReportDeterministic,
  historyTextsOnly,
  readReportProvenance,
  stripLegacyProvenance,
} from "../lib/report-provenance.js";
import { resolveModel } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `report` command.
 */
export interface ReportOptions {
  /** Path to the repository. */
  repo: string;
  /** Ollama base URL override. */
  url?: string;
  /** Model name; skips the interactive picker. */
  model?: string;
  /** Only fold the first N groups (useful for trials). */
  limit?: number;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

const nonEmpty = (value: unknown): string[] =>
  typeof value === "string" && value.trim() ? [value] : [];

const uniq = (values: string[]): string[] => [...new Set(values)];

/** The single generic low-tier item all routine upkeep collapses into. */
const MAINTENANCE_BULLET =
  "Ongoing maintenance: dependency updates, version releases, and build/CI upkeep.";

/** Ensures the low tier carries the generic maintenance bullet (once). */
function ensureMaintenanceBullet(low: string[]): string[] {
  if (low.some((b) => /maintenance|upkeep/i.test(b))) return low;
  return [...low, MAINTENANCE_BULLET];
}

function writeReport(reportsDir: string, record: ReportRecord): void {
  writeRecordJson(path.join(reportsDir, `${record.reportId}.json`), stripLegacyProvenance(record));
}

/** Seeds a report from the first group (no merge needed). */
function initReport(
  file: string,
  group: GroupRecord,
  generatedAt: string,
  model: string,
): ReportRecord {
  const g = group.model;
  const historySources = g?.history ? [[file]] : [];
  return {
    reportId: group.timestampEnd,
    sourceGroups: uniq([file]),
    groupCount: 1,
    deterministic: buildReportDeterministic(group.deterministic, historySources),
    model: {
      changeTypes: g?.changeTypes ?? [],
      technologies: mergeTechnologies(g?.technologies),
      technicalSignal: g?.technicalSignal ?? "low",
      architectureSignal: g?.architectureSignal ?? "low",
      securitySignal: g?.securitySignal ?? "low",
      signalReasons: {
        technical: nonEmpty(g?.signalReasons.technical),
        architecture: nonEmpty(g?.signalReasons.architecture),
        security: nonEmpty(g?.signalReasons.security),
      },
      questionsAnalyses: g?.questionsAnalyses ?? [],
      confidence: g?.confidence ?? "low",
      hiContext: g?.hiContext ?? [],
      mediumContext: g?.mediumContext ?? [],
      lowContext: g?.lowContext ?? [],
      provenance: { model, generatedAt },
    },
    history: g?.history ? [{ text: g.history }] : [],
  };
}

/**
 * Folds work-session groups into a cumulative report, writing one report file
 * per fold step. Each merge runs LLM sessions (model merge, per-summary adjust,
 * dedup judge).
 * @param options - Resolved command options.
 */
export async function report(options: ReportOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const groupsDir = repoGroupsDir(repoPath, options.period);

  const groups = loadGroupRecords(groupsDir).filter((g) => g.record.model !== null);
  const skippedNoModel = loadGroupRecords(groupsDir).length - groups.length;
  if (groups.length === 0) {
    console.log(
      `No summarized groups found for ${repoPath}. Run \`dev-workgraph commit-group\` first.`,
    );
    return;
  }

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should fold the report?",
    saved: savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, reportModel: model });

  const reportsDir = repoReportsDir(repoPath, options.period);
  const selected = options.limit ? groups.slice(0, options.limit) : groups;
  fs.mkdirSync(reportsDir, { recursive: true });

  // Resume: each fold writes reports/<group.timestampEnd>.json, so the existing
  // files form a prefix of `selected`. Load the longest existing prefix and
  // continue from the next group.
  let current: ReportRecord | null = null;
  let startIndex = 0;
  for (let i = 0; i < selected.length; i += 1) {
    const f = path.join(reportsDir, `${selected[i]?.record.timestampEnd}.json`);
    if (!fs.existsSync(f)) break;
    const loaded = JSON.parse(fs.readFileSync(f, "utf8")) as ReportRecord;
    current = {
      ...loaded,
      history: historyTextsOnly(loaded.history),
    };
    startIndex = i + 1;
  }

  if (startIndex >= selected.length && current) {
    console.log(`Report already complete (${path.join(reportsDir, `${current.reportId}.json`)}).`);
    return;
  }

  const projectBlock = projectContextBlock(loadProjectContext(repoPath, options.period));
  if (!projectBlock) {
    console.log("⚠️  No project context (run `dev-workgraph init`); folding without it.");
  }
  console.log(
    `Folding ${selected.length} group(s)${skippedNoModel ? ` (${skippedNoModel} skipped: no model)` : ""}${startIndex > 0 ? ` — resuming at ${startIndex + 1}` : ""} with "${model}" at ${baseUrl}\n`,
  );

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("report");

  try {
    for (let i = startIndex; i < selected.length; i += 1) {
      const entry = selected[i];
      if (!entry) continue;
      const { file, record } = entry;
      const generatedAt = new Date().toISOString();
      console.log(`[${i + 1}/${selected.length}] fold ${file} (${record.commitCount} commits)`);

      if (current === null) {
        current = initReport(file, record, generatedAt, model);
        console.log(`   seeded report (${current.history.length} history entry)`);
      } else {
        current = await foldGroup(
          current,
          file,
          record,
          baseUrl,
          model,
          generatedAt,
          projectBlock,
          tracker,
        );
      }

      writeReport(reportsDir, current);
      console.log(`   → ${current.reportId}.json (${current.history.length} history entries)`);
    }
  } finally {
    tracker.endStep();
  }

  console.log(`\n✅ Report built: ${path.join(reportsDir, `${current?.reportId}.json`)}`);
}

/**
 * Folds one group into the accumulated report via the LLM sessions.
 */
async function foldGroup(
  prev: ReportRecord,
  file: string,
  group: GroupRecord,
  baseUrl: string,
  model: string,
  generatedAt: string,
  projectBlock: string,
  tracker: TokenUsageTracker,
): Promise<ReportRecord> {
  const g = group.model;
  const prevProvenance = readReportProvenance(prev);
  const sourceGroups = [...prevProvenance.sourceGroups, file];
  let historySources = prevProvenance.historySources.map((row) => [...row]);

  const mergedFrom = {
    previousReportId: prev.reportId,
    previousReportFile: `${prev.reportId}.json`,
    groupFile: file,
  };
  const routineSystem = withProjectContext(projectBlock, ROUTINE_CHECK_SYSTEM);
  const mergeSystem = withProjectContext(projectBlock, REPORT_MERGE_SYSTEM);
  const newSystem = withProjectContext(projectBlock, REPORT_NEW_HISTORY_SYSTEM);
  const compactSystem = withProjectContext(projectBlock, REPORT_COMPACT_SYSTEM);
  const cap = (items: string[]): string[] => items.slice(0, MAX_CONTEXT_BULLETS);

  // Deterministic + signal levels (pure code).
  const mergedDeterministic = mergeDeterministic(prev.deterministic, group.deterministic);
  const technicalSignal = maxSignal(prev.model.technicalSignal, g?.technicalSignal ?? "low");
  const architectureSignal = maxSignal(
    prev.model.architectureSignal,
    g?.architectureSignal ?? "low",
  );
  const securitySignal = maxSignal(prev.model.securitySignal, g?.securitySignal ?? "low");

  // Step 1 — routine gate (LLM): does this session carry ONLY routine upkeep? If so, fold it
  // deterministically (accumulate evidence + one generic maintenance bullet, leave history alone)
  // and skip the heavier merge/add/compact sessions.
  process.stdout.write("   [1/4] classify routine vs substantive ... ");
  const check = (await chatJson({
    baseUrl,
    model,
    system: routineSystem,
    user: buildRoutineCheckPrompt(group),
    schema: routineCheckJsonSchema(),
    tracker,
  })) as { routine?: boolean };

  if (check.routine) {
    console.log("routine — folded without further LLM");
    return {
      reportId: group.timestampEnd,
      sourceGroups: uniq(sourceGroups),
      groupCount: prev.groupCount + 1,
      deterministic: buildReportDeterministic(mergedDeterministic, historySources),
      model: {
        ...prev.model,
        technicalSignal,
        architectureSignal,
        securitySignal,
        changeTypes: uniq([...prev.model.changeTypes, ...(g?.changeTypes ?? [])]),
        technologies: mergeTechnologies(prev.model.technologies, g?.technologies),
        lowContext: cap(ensureMaintenanceBullet(prev.model.lowContext)),
        provenance: { model, generatedAt },
      },
      history: prev.history.map((h) => ({ text: h.text })),
      mergeCursor: prev.mergeCursor,
      mergedFrom,
    };
  }
  console.log("substantive");

  // LLM session 1 — merge the model layers (contexts are role-prioritized + capped by the prompt;
  // the slice is a hard backstop so the next merge prompt stays bounded).
  process.stdout.write("   [2/4] merge signals + context tiers ... ");
  const merged = (await chatJson({
    baseUrl,
    model,
    system: mergeSystem,
    user: buildReportMergePrompt(prev, group),
    schema: reportMergeJsonSchema(),
    tracker,
  })) as Record<string, unknown>;
  console.log("ok");

  const contexts = {
    hiContext: cap(asStringArray(merged.hiContext)),
    mediumContext: cap(asStringArray(merged.mediumContext)),
    lowContext: cap(asStringArray(merged.lowContext)),
  };
  const reasons = (merged.signalReasons ?? {}) as Record<string, unknown>;

  const newModel: ReportModelLayer = {
    changeTypes: asStringArray(merged.changeTypes),
    technologies: mergeTechnologies(prev.model.technologies, g?.technologies),
    technicalSignal,
    architectureSignal,
    securitySignal,
    signalReasons: {
      technical: cap(asStringArray(reasons.technical)),
      architecture: cap(asStringArray(reasons.architecture)),
      security: cap(asStringArray(reasons.security)),
    },
    questionsAnalyses: cleanQuestionAnalyses(merged.questionsAnalyses).slice(
      0,
      MAX_CONTEXT_BULLETS,
    ),
    confidence: (merged.confidence as Signal) ?? prev.model.confidence,
    ...contexts,
    provenance: { model, generatedAt },
  };

  // History text grows via LLM only when the new session adds something not already covered.
  // Provenance rows are maintained deterministically in parallel (historySources).
  let history: ReportHistoryEntry[] = prev.history.map((h) => ({ text: h.text }));

  const candidate = g?.history ?? "";
  if (candidate) {
    process.stdout.write(`   [3/4] history add-if-new (have ${history.length}) ... `);
    const verdict = (await chatJson({
      baseUrl,
      model,
      system: newSystem,
      user: buildReportNewHistoryPrompt(
        history.map((h) => h.text),
        contexts,
        candidate,
      ),
      schema: reportNewHistoryJsonSchema(),
      tracker,
    })) as { needed?: boolean; text?: string };

    if (verdict.needed && verdict.text?.trim()) {
      history.push({ text: verdict.text.trim() });
      historySources.push([file]);
      console.log("added");
    } else {
      console.log("nothing new");
    }
  } else {
    console.log("   [3/4] history add-if-new ... skipped (group has no history)");
  }

  // Compaction — rolling merge pointer. When over the cap, merge exactly the pair
  // at `cursor` (the entry there + its older neighbour) into one role-prioritized
  // entry, then advance the cursor down the list (wrapping to the oldest). This
  // spreads compression evenly across all ages instead of repeatedly re-squashing
  // the oldest blob, and keeps the list bounded to MAX_HISTORY_ENTRIES.
  let cursor = prev.mergeCursor ?? 0;
  if (history.length > MAX_HISTORY_ENTRIES) {
    // After this merge the list will hold MAX_HISTORY_ENTRIES entries, whose valid
    // pair-start positions are 0 .. MAX_HISTORY_ENTRIES-2. Clamp a stale/out-of-range
    // cursor back into that window before merging.
    const lastPairStart = MAX_HISTORY_ENTRIES - 2;
    if (cursor > lastPairStart) cursor = 0;

    const a = history[cursor];
    const b = history[cursor + 1];
    const aSources = historySources[cursor];
    const bSources = historySources[cursor + 1];
    if (a && b && aSources && bSources) {
      process.stdout.write(`   [4/4] compact pair @${cursor}+${cursor + 1} → 1 ... `);
      const condensed = (await chatJson({
        baseUrl,
        model,
        system: compactSystem,
        user: buildReportCompactPrompt([a.text, b.text]),
        schema: reportHistoryJsonSchema(),
        tracker,
      })) as { history?: unknown };

      const condensedTexts = asStringArray(condensed.history);
      const mergedText =
        condensedTexts.length > 0 ? condensedTexts.join(" ") : `${a.text} ${b.text}`;
      history = [...history.slice(0, cursor), { text: mergedText }, ...history.slice(cursor + 2)];
      historySources = [
        ...historySources.slice(0, cursor),
        uniq([...aSources, ...bSources]),
        ...historySources.slice(cursor + 2),
      ];

      // Advance the cursor; wrap to the oldest once it passes the last pair.
      cursor = cursor + 1 > lastPairStart ? 0 : cursor + 1;
      console.log(`ok (history now ${history.length}, next cursor @${cursor})`);
    }
  }

  return {
    reportId: group.timestampEnd,
    sourceGroups: uniq(sourceGroups),
    groupCount: prev.groupCount + 1,
    deterministic: buildReportDeterministic(mergedDeterministic, historySources),
    model: newModel,
    history,
    mergeCursor: cursor,
    mergedFrom,
  };
}
