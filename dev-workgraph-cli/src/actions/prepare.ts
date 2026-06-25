// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  repoFinishDir,
  repoPreparedDir,
  repoReportsDir,
  setOllamaConfig,
} from "../lib/config.js";
import { latestFinish } from "../lib/finish-load.js";
import { resolveRepo } from "../lib/git.js";
import {
  cleanQuestionAnalyses,
  flattenQuestions,
  groupHistoryJsonSchema,
  mergeTechnologies,
  prepareQuestionsJsonSchema,
  prepareReasonsJsonSchema,
  prepareTechnologiesJsonSchema,
  type Signal,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildPrepareHistoryPrompt,
  buildPrepareQuestionsPrompt,
  buildPrepareReasonsPrompt,
  buildPrepareTechPrompt,
  PREPARE_HISTORY_SYSTEM,
  PREPARE_QUESTIONS_SYSTEM,
  PREPARE_REASONS_SYSTEM,
  PREPARE_TECH_SYSTEM,
  projectContextBlock,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type { PreparedModelLayer, PreparedRecord, ReportRecord } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `prepare` command.
 */
export interface PrepareOptions {
  /** Path to the repository. */
  repo: string;
  /** Ollama base URL override. */
  url?: string;
  /** Model name; skips the interactive picker. */
  model?: string;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

/** Returns the latest report (highest reportId) with its file name, or null. */
function latestReport(reportsDir: string): { file: string; record: ReportRecord } | null {
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs
    .readdirSync(reportsDir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
  const file = files[0];
  if (!file) return null;
  return {
    file,
    record: JSON.parse(fs.readFileSync(path.join(reportsDir, file), "utf8")) as ReportRecord,
  };
}

/**
 * Distills the latest report into a single role-aligned prepared narrative.
 * @param options - Resolved command options.
 */
export async function prepare(options: PrepareOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);

  const project = loadProjectContext(repoPath, options.period);
  if (!project) {
    console.error("✖ No project context. Run `dev-workgraph init` first.");
    process.exitCode = 1;
    return;
  }

  const latest = latestReport(repoReportsDir(repoPath, options.period));
  if (!latest) {
    console.log(`No report found for ${repoPath}. Run \`dev-workgraph report\` first.`);
    return;
  }
  const report = latest.record;

  const preparedDir = repoPreparedDir(repoPath, options.period);
  const preparedFile = path.join(preparedDir, `${report.reportId}.json`);
  if (fs.existsSync(preparedFile)) {
    console.log(`Prepared narrative already exists (${preparedFile}).`);
    return;
  }

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should prepare the narrative?",
    saved: savedOllama?.narrativeModel ?? savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, narrativeModel: model });

  const projectBlock = projectContextBlock(project);
  const generatedAt = new Date().toISOString();
  const m = report.model;
  console.log(
    `Preparing narrative from ${latest.file} (${report.groupCount} groups) with "${model}"\n`,
  );

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("prepare");

  try {
    // Step 1 — concatenate report history (deterministic).
    const rawHistory = report.history.map((h) => h.text).join("\n");

    // Step 2 — compose one unified history.
    process.stdout.write("   [1/4] compose unified history ... ");
    const composed = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, PREPARE_HISTORY_SYSTEM),
      user: buildPrepareHistoryPrompt(
        rawHistory,
        {
          technical: m.technicalSignal,
          architecture: m.architectureSignal,
          security: m.securitySignal,
        },
        m.changeTypes,
      ),
      schema: groupHistoryJsonSchema(),
      tracker,
    })) as { history?: string };
    const history = composed.history?.trim() ?? rawHistory;
    console.log("ok");

    // Step 3 — clean & collapse the accumulated technology list (dedupe + class hierarchy).
    let technologies = mergeTechnologies(m.technologies);
    if (technologies.length > 0) {
      process.stdout.write(`   [2/4] clean technologies (${technologies.length}) ... `);
      const cleaned = (await chatJson({
        baseUrl,
        model,
        system: withProjectContext(projectBlock, PREPARE_TECH_SYSTEM),
        user: buildPrepareTechPrompt(technologies),
        schema: prepareTechnologiesJsonSchema(),
        tracker,
      })) as { technologies?: unknown };
      const result = asStringArray(cleaned.technologies).slice(0, 5);
      if (result.length > 0) technologies = result;
      console.log(`ok (${technologies.length})`);
    } else {
      console.log("   [2/4] clean technologies ... skipped (none)");
    }

    // Step 4 — collapse signal reasons into four.
    process.stdout.write("   [3/4] collapse signal reasons → 4 ... ");
    const collapsed = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, PREPARE_REASONS_SYSTEM),
      user: buildPrepareReasonsPrompt(m.signalReasons, history),
      schema: prepareReasonsJsonSchema(),
      tracker,
    })) as { signalReasons?: unknown };
    const signalReasons = asStringArray(collapsed.signalReasons).slice(0, 4);
    console.log(`ok (${signalReasons.length})`);

    // Step 5 — reframe role-aware questionsAnalyses + confidence.
    process.stdout.write("   [4/4] reframe open questions → 4 ... ");
    const priorQa = latestFinish(repoFinishDir(repoPath, options.period))?.record.answers ?? [];
    const reframed = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, PREPARE_QUESTIONS_SYSTEM),
      user: buildPrepareQuestionsPrompt(history, signalReasons, m.questionsAnalyses, priorQa),
      schema: prepareQuestionsJsonSchema(),
      tracker,
    })) as { questionsAnalyses?: unknown; confidence?: string };
    const questionsAnalyses = cleanQuestionAnalyses(reframed.questionsAnalyses).slice(0, 4);
    const questions = flattenQuestions(questionsAnalyses);
    console.log(`ok (${questions.length})`);

    const model_: PreparedModelLayer = {
      changeTypes: m.changeTypes,
      technologies,
      technicalSignal: m.technicalSignal,
      architectureSignal: m.architectureSignal,
      securitySignal: m.securitySignal,
      signalReasons,
      questionsAnalyses,
      confidence: (reframed.confidence as Signal) ?? m.confidence,
      history,
      provenance: { model, generatedAt, sourceReport: latest.file },
    };
    const record: PreparedRecord = {
      preparedId: report.reportId,
      sourceReport: latest.file,
      groupCount: report.groupCount,
      model: model_,
    };

    fs.mkdirSync(preparedDir, { recursive: true });
    writeRecordJson(preparedFile, record);

    // Preview the prepared narrative + questions so it's clear what `final` will ask.
    console.log("\n─── Prepared narrative ───────────────────────────────────");
    console.log(history || "(empty)");
    console.log("\n─── Technologies ─────────────────────────────────────────");
    console.log(technologies.length > 0 ? technologies.join(", ") : "(none)");
    console.log("\n─── Questions `final` will ask ───────────────────────────");
    if (questions.length === 0) {
      console.log("(none)");
    } else {
      questions.forEach((q, i) => {
        console.log(`${i + 1}. ${q}`);
      });
    }
    console.log("──────────────────────────────────────────────────────────");

    console.log(`\n✅ Prepared narrative: ${preparedFile}`);
  } finally {
    tracker.endStep();
  }
}
