// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import {
  loadConfig,
  repoFinishDir,
  repoPreparedDir,
  repoReportsDir,
  setOllamaConfig,
} from "../lib/config.js";
import {
  latestFinish,
  loadPreparedRecord,
  loadReportRecord,
  nextFinishVersion,
  versionedReconstructionName,
} from "../lib/finish-load.js";
import { resolveRepo } from "../lib/git.js";
import {
  cleanQuestionAnalyses,
  cvBulletsJsonSchema,
  flattenQuestions,
  groupHistoryJsonSchema,
  prepareQuestionsJsonSchema,
  roleNarrativeJsonSchema,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildCvBulletsPrompt,
  buildDeepenImpactNarrativePrompt,
  buildDeepenQuestionsPrompt,
  buildRoleNarrativePrompt,
  CV_BULLETS_SYSTEM,
  combinePreparedAndPriorHistory,
  DEEPEN_QUESTIONS_SYSTEM,
  IMPACT_NARRATIVE_SYSTEM,
  projectContextBlock,
  ROLE_NARRATIVE_SYSTEM,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type { FinishRecord, ProjectContext } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `deepen` command.
 *
 * Post-`final` extension: load the latest finish archive, capture {@link FinishRecord.recalledContext},
 * generate four new follow-up questions, collect answers, refine IMPACT + Role Narrative over
 * cumulative Q&A, and append a versioned finish (`*.v2.json`, …) without overwriting v1.
 * Not part of `run`.
 */
export interface DeepenOptions {
  /** Absolute or relative path to the Git repository. */
  repo: string;
  /** JSON file with answers to the four **new** questions only (non-interactive). */
  answersFile?: string;
  /**
   * Plain-text file with {@link FinishRecord.recalledContext recalled context} for this round
   * (skips the interactive editor). Empty file is allowed — questions then rely on prior Q&A only.
   */
  contextFile?: string;
  /** Override path for the markdown deliverable (default: cwd `RECONSTRUCTION.<project>.vN.md`). */
  output?: string;
  /** Ollama base URL override. */
  url?: string;
  /** `narrativeModel` name; skips the interactive picker when set. */
  model?: string;
  /** Scope all reads/writes to `periods/<id>/` instead of the repo's all-time data. */
  period?: string;
}

/** One question-answer pair collected from the developer. */
interface QA {
  question: string;
  answer: string;
}

/** Coerces an unknown JSON value to a non-empty string array. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

/** Loads Q&A for the four new deepen questions from JSON (array or `{ answers: [...] }`). */
function readAnswersFile(p: string, questions: string[]): QA[] {
  const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { answers?: unknown }).answers ?? []);
  return (arr as { question?: string; answer?: string }[]).map((x, i) => ({
    question: x.question ?? questions[i] ?? `Question ${i + 1}`,
    answer: x.answer ?? "",
  }));
}

/** Collects answers to the four new deepen questions interactively (multi-line editor). */
async function collectAnswers(questions: string[]): Promise<QA[]> {
  const pairs: QA[] = [];
  for (const [i, question] of questions.entries()) {
    const { answer } = await inquirer.prompt<{ answer: string }>([
      {
        type: "editor",
        name: "answer",
        message: `(${i + 1}/${questions.length}) ${question}`,
      },
    ]);
    pairs.push({ question, answer: (answer ?? "").trim() });
  }
  return pairs;
}

/**
 * Step 1 — {@link FinishRecord.recalledContext recalled context} (interactive or `--context-file`).
 *
 * Human memories about the project that Git cannot show: team, decisions, constraints,
 * handoffs, pivots, meetings, why something mattered. Starting context for sharper
 * follow-up questions; not proof of production impact unless stated explicitly.
 *
 * @param contextFile - When set, read plain text from this path instead of prompting.
 * @returns Trimmed text, or empty string if the user skipped / file is empty.
 */
async function resolveRecalledContext(contextFile?: string): Promise<string> {
  if (contextFile) {
    return fs.readFileSync(path.resolve(contextFile), "utf8").trim();
  }
  const { recalled } = await inquirer.prompt<{ recalled: string }>([
    {
      type: "editor",
      name: "recalled",
      message:
        "What did you remember about working on this project that is NOT visible in the code?\n" +
        "(team, decisions, constraints, handoffs, pivots, meetings, why something mattered — plain text)",
    },
  ]);
  return (recalled ?? "").trim();
}

/**
 * Step 5 — deterministic assembly of the versioned RECONSTRUCTION markdown.
 *
 * Same section layout as `final`, plus **Recalled context (this deepen round)** when
 * {@link FinishRecord.recalledContext} is non-empty. Lists **all** cumulative Q&A pairs.
 *
 * @param project - Loaded `project.json` (profile, role).
 * @param role - Developer role string for the IMPACT heading.
 * @param impactHistory - Refined "Your IMPACT" prose from step 4a.
 * @param technologies - Copied from the prepared record.
 * @param narrative - Four Role Narrative bullets from step 4b.
 * @param cvBullets - Four impersonal CV bullets from step 4c.
 * @param qa - Cumulative Q&A (prior finish answers + four new pairs).
 * @param recalledContext - Optional non-code context for this deepen round; omitted from
 *   markdown and finish JSON when empty.
 */
function assembleMarkdown(
  project: ProjectContext,
  role: string,
  impactHistory: string,
  technologies: string[],
  narrative: string[],
  cvBullets: string[],
  qa: QA[],
  recalledContext?: string,
): string {
  const p = project.profile;
  const context = [p.domains.join(", "), p.apparentStack.join(", ")].filter(Boolean).join(" · ");
  const sections = [
    "## PROJECT DESCRIPTION",
    "",
    p.summary || "(no summary)",
    context ? `\n_${context}_` : "",
    "",
    `## Your IMPACT as ${role}`,
    "",
    impactHistory || "(no history)",
  ];
  if (recalledContext?.trim()) {
    sections.push("", "## Recalled context (this deepen round)", "", recalledContext.trim());
  }
  sections.push(
    "",
    "## Technologies",
    "",
    technologies.length > 0 ? technologies.join(", ") : "(none)",
    "",
    "## Impact bullet points (Role Narrative)",
    "",
    ...(narrative.length > 0 ? narrative.map((b) => `- ${b}`) : ["- (none)"]),
    "",
    "## CV bullets",
    "",
    ...(cvBullets.length > 0 ? cvBullets.map((b) => `- ${b}`) : ["- (none)"]),
    "",
    "## Possible questions",
    "",
    ...qa.flatMap((x) => [`**Q:** ${x.question}`, `**A:** ${x.answer || "(no answer)"}`, ""]),
  );
  return sections.join("\n");
}

/**
 * Returns the next version's JSON file name when that archive already exists on disk.
 *
 * @param finishDir - Repo (or period) finish directory.
 * @param priorFile - File name of the finish record being extended.
 * @returns Existing next-version JSON file name, or `null` if the next slot is free.
 */
function nextFinishExists(finishDir: string, priorFile: string): string | null {
  const next = nextFinishVersion(priorFile);
  const nextPath = path.join(finishDir, next.jsonFile);
  return fs.existsSync(nextPath) ? next.jsonFile : null;
}

/**
 * Extends the latest finish archive with a narrative deepen round (§11.5).
 *
 * Provenance chain only — does not read commits, groups, or evidence directly:
 * `latest finish` → `prepared` → `report` (via `sourcePrepared` / `sourceReport`).
 *
 * Pipeline:
 * 1. {@link resolveRecalledContext} — optional non-code context for this round.
 * 2. `narrativeModel` — four new follow-up questions (must not repeat prior Q&A).
 * 3. Interactive (or `--answers-file`) — four new answers; merged into cumulative `answers[]`.
 * 4a. `narrativeModel` — refine IMPACT from prepare baseline + prior final history + all Q&A.
 * 4b. `narrativeModel` — four Role Narrative bullets (same inputs + recalled context).
 * 4c. `narrativeModel` — four impersonal CV bullets (role-calibrated).
 * 5. Write `RECONSTRUCTION.<project>.vN.md` to cwd and append-only `finish/<id>.vN.{md,json}`.
 *
 * Skips when no finish exists, prior finish has no answers, or the next version file
 * already exists. Never overwrites v1 or prior deepen versions.
 *
 * @param options - Resolved CLI options.
 */
export async function deepen(options: DeepenOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);

  const project = loadProjectContext(repoPath, options.period);
  if (!project) {
    console.error("✖ No project context. Run `dev-workgraph init` first.");
    process.exitCode = 1;
    return;
  }

  const finishDir = repoFinishDir(repoPath, options.period);
  const priorFinish = latestFinish(finishDir);
  if (!priorFinish) {
    console.log(`No finish archive for ${repoPath}. Run \`dev-workgraph final\` first.`);
    return;
  }

  const preparedDir = repoPreparedDir(repoPath, options.period);
  const reportsDir = repoReportsDir(repoPath, options.period);

  let prepared: ReturnType<typeof loadPreparedRecord>;
  let report: ReturnType<typeof loadReportRecord>;
  try {
    prepared = loadPreparedRecord(preparedDir, priorFinish.record.sourcePrepared);
    report = loadReportRecord(reportsDir, priorFinish.record.sourceReport);
  } catch (err) {
    console.error(`✖ ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const prior = priorFinish.record;
  const priorQa = prior.answers ?? [];
  if (priorQa.length === 0) {
    console.error("✖ Latest finish has no saved answers. Run `dev-workgraph final` first.");
    process.exitCode = 1;
    return;
  }

  const existing = nextFinishExists(finishDir, priorFinish.file);
  if (existing) {
    console.log(`Finish version already exists (${existing}).`);
    return;
  }

  const nextArchive = nextFinishVersion(priorFinish.file);

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should deepen the narrative?",
    saved: savedOllama?.narrativeModel ?? savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, narrativeModel: model });

  const projectBlock = projectContextBlock(project);
  const generatedAt = new Date().toISOString();

  console.log(
    `\nDeepening from finish ${priorFinish.file} → prepared ${prepared.file} → report ${report.file}\n`,
  );

  console.log(
    "First, capture anything you remembered about the project that Git cannot show\n" +
      "(role + project.json context will also guide the new questions).\n",
  );
  const recalledContext = await resolveRecalledContext(options.contextFile);
  if (!recalledContext) {
    console.log(
      "(No recalled context provided — questions will rely on prior Q&A and project.json only.)\n",
    );
  }

  const preparedHistory = prepared.record.model.history;
  const priorHistory = prior.history;
  const historyBase = combinePreparedAndPriorHistory(preparedHistory, priorHistory);

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("deepen");

  let impactHistory = historyBase;
  let narrative: string[] = [];
  let cvBullets: string[] = [];
  let allQa: QA[] = [...priorQa];

  try {
    process.stdout.write("Generating four new follow-up questions ... ");
    const followUp = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, DEEPEN_QUESTIONS_SYSTEM),
      user: buildDeepenQuestionsPrompt(
        preparedHistory,
        priorHistory,
        prepared.record.model.signalReasons,
        flattenQuestions(report.record.model.questionsAnalyses),
        flattenQuestions(prepared.record.model.questionsAnalyses),
        priorQa,
        recalledContext,
      ),
      schema: prepareQuestionsJsonSchema(),
      tracker,
    })) as { questionsAnalyses?: unknown };
    const newQuestions = flattenQuestions(cleanQuestionAnalyses(followUp.questionsAnalyses)).slice(
      0,
      4,
    );
    if (newQuestions.length < 4) {
      console.error("\n✖ Model returned fewer than four new questions.");
      process.exitCode = 1;
      return;
    }
    console.log("ok");

    newQuestions.forEach((q, i) => {
      console.log(`   ${i + 1}. ${q}`);
    });

    let newQa: QA[];
    if (options.answersFile) {
      newQa = readAnswersFile(options.answersFile, newQuestions);
    } else {
      console.log("\nAnswer the four new questions:");
      newQa = await collectAnswers(newQuestions);
    }

    allQa = [...priorQa, ...newQa];

    process.stdout.write("\nRefining Your IMPACT with all answers ... ");
    const refined = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, IMPACT_NARRATIVE_SYSTEM),
      user: buildDeepenImpactNarrativePrompt(preparedHistory, priorHistory, allQa, recalledContext),
      schema: groupHistoryJsonSchema(),
      tracker,
    })) as { history?: string };
    impactHistory = refined.history?.trim() || historyBase;
    console.log("ok");

    process.stdout.write("Writing Role Narrative ... ");
    const result = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, ROLE_NARRATIVE_SYSTEM),
      user: buildRoleNarrativePrompt(
        impactHistory,
        prepared.record.model.signalReasons,
        allQa,
        recalledContext,
      ),
      schema: roleNarrativeJsonSchema(),
      tracker,
    })) as { narrative?: unknown };
    narrative = asStringArray(result.narrative).slice(0, 4);
    console.log(`ok (${narrative.length} bullets)`);

    process.stdout.write("Writing CV bullets ... ");
    const cvResult = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, CV_BULLETS_SYSTEM),
      user: buildCvBulletsPrompt(
        project.role,
        impactHistory,
        prepared.record.model.signalReasons,
        allQa,
        narrative,
      ),
      schema: cvBulletsJsonSchema(),
      tracker,
    })) as { cvBullets?: unknown };
    cvBullets = asStringArray(cvResult.cvBullets).slice(0, 4);
    console.log(`ok (${cvBullets.length} bullets)`);
  } finally {
    tracker.endStep();
  }

  if (process.exitCode === 1) return;

  const projectName = path.basename(repoPath);
  const role = project.role;
  const md = assembleMarkdown(
    project,
    role,
    impactHistory,
    prepared.record.model.technologies,
    narrative,
    cvBullets,
    allQa,
    recalledContext,
  );

  const outPath = options.output
    ? path.resolve(options.output)
    : path.join(
        process.cwd(),
        versionedReconstructionName(repoPath, nextArchive.version, options.period),
      );
  fs.writeFileSync(outPath, `${md}\n`, "utf8");
  console.log(`\n✅ Wrote ${outPath} (${allQa.length} Q&A pairs, finish v${nextArchive.version})`);

  fs.mkdirSync(finishDir, { recursive: true });
  const finishMdPath = path.join(finishDir, nextArchive.mdFile);
  const finishJsonPath = path.join(finishDir, nextArchive.jsonFile);
  fs.writeFileSync(finishMdPath, `${md}\n`, "utf8");

  const finishRecord: FinishRecord = {
    finishId: nextArchive.baseFinishId,
    sourcePrepared: prepared.file,
    sourceReport: prepared.record.sourceReport,
    sourcePreviousFinish: priorFinish.file,
    version: nextArchive.version,
    round: nextArchive.version,
    project: projectName,
    role,
    technologies: prepared.record.model.technologies,
    history: impactHistory,
    narrative,
    cvBullets,
    answers: allQa,
    outputMarkdown: path.basename(finishMdPath),
    ...(recalledContext ? { recalledContext } : {}),
    provenance: { model, generatedAt },
  };
  writeRecordJson(finishJsonPath, finishRecord);
  console.log(`✅ Archived deepened finish to ${finishDir} (${finishJsonPath})`);
}
