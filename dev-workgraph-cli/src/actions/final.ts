// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import { repoFinishDir, repoPreparedDir } from "../lib/config.js";
import {
  defaultReconstructionName,
  extendSourceQuestions,
  finishJsonFileName,
  finishMdFileName,
  finishQuestionsJsonFileName,
  latestFinish,
  nextFinishVersion,
  versionedReconstructionName,
} from "../lib/finish-load.js";
import {
  allQuestionsAnswered,
  collectFinishAnswers,
  createFinishQuestions,
  loadFinishQuestions,
  normalizeFinishAnswers,
  questionAnalysesForRecord,
  questionsNotYetAnswered,
  readFinishAnswersFile,
  resolveAnswersToQa,
  resolveRoundQuestionAnalyses,
  writeFinishQuestions,
} from "../lib/finish-questions.js";
import { resolveRepo } from "../lib/git.js";
import type { LlmCommandOptions } from "../lib/llm/cli-options.js";
import type { LlmProviderId } from "../lib/llm/types.js";
import {
  cvBulletsJsonSchema,
  flattenQuestions,
  groupHistoryJsonSchema,
  type QuestionAnalyses,
  roleNarrativeJsonSchema,
} from "../lib/model.js";
import { chatJson } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildCvBulletsPrompt,
  buildDeepenImpactNarrativePrompt,
  buildImpactNarrativePrompt,
  buildRoleNarrativePrompt,
  CV_BULLETS_SYSTEM,
  IMPACT_NARRATIVE_SYSTEM,
  projectContextBlock,
  ROLE_NARRATIVE_SYSTEM,
  withProjectContext,
} from "../lib/prompts.js";
import { writeRecordJson } from "../lib/record-io.js";
import type {
  FinishAnswer,
  FinishQuestionsRecord,
  FinishRecord,
  PreparedRecord,
} from "../lib/records.js";
import { resolveLlmSlot } from "../lib/select.js";
import { signalReasonArrayTexts } from "../lib/signal-reason-provenance.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `final` command.
 */
export interface FinalOptions extends LlmCommandOptions {
  /** Path to the repository. */
  repo: string;
  /** Pre-written Q&A as JSON (non-interactive). */
  answersFile?: string;
  /** Output markdown path (default: ./RECONSTRUCTION.<project>.md). */
  output?: string;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];

/** Returns the latest prepared record with its file path, or null. */
function latestPrepared(dir: string): { file: string; record: PreparedRecord } | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
  const file = files[0];
  if (!file) return null;
  return {
    file,
    record: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as PreparedRecord,
  };
}

interface FinishArchive {
  baseFinishId: number;
  version: number;
  jsonFile: string;
  mdFile: string;
}

function isFinalExtension(
  latestFile: string,
  priorFinish: ReturnType<typeof latestFinish>,
): boolean {
  return (
    priorFinish !== null &&
    (priorFinish.record.answers?.length ?? 0) > 0 &&
    latestFile !== priorFinish.record.sourcePrepared
  );
}

function resolveFinishArchive(
  priorFinish: NonNullable<ReturnType<typeof latestFinish>>,
): FinishArchive {
  return nextFinishVersion(priorFinish.file);
}

function initialFinishArchive(prepared: PreparedRecord): FinishArchive {
  return {
    baseFinishId: prepared.preparedId,
    version: 1,
    jsonFile: finishJsonFileName(prepared.preparedId, 1),
    mdFile: finishMdFileName(prepared.preparedId, 1),
  };
}

function ensureQuestionsRecord(
  finishDir: string,
  questionsPath: string,
  archive: FinishArchive,
  prepared: PreparedRecord,
  isExtension: boolean,
  questionsToAsk: string[],
  roundAnalyses: QuestionAnalyses[],
): FinishQuestionsRecord {
  if (fs.existsSync(questionsPath)) {
    const existing = loadFinishQuestions(questionsPath);
    if (existing.questionsAnalyses?.length || !isExtension) return existing;
  }
  const texts = isExtension ? questionsToAsk : flattenQuestions(roundAnalyses).slice(0, 4);
  const analysesForRound = isExtension
    ? roundAnalyses.filter((thread) => thread.question.some((q) => questionsToAsk.includes(q)))
    : roundAnalyses.slice(0, 4);
  const questionsRecord = createFinishQuestions(
    texts,
    {
      sourceFinal: archive.jsonFile,
      sourceReport: prepared.sourceReport,
    },
    Date.now(),
    analysesForRound,
  );
  fs.mkdirSync(finishDir, { recursive: true });
  writeFinishQuestions(questionsPath, questionsRecord);
  return questionsRecord;
}

function loadSavedRoundAnswers(
  finishJsonPath: string,
  questionsRecord: FinishQuestionsRecord,
  answersFile: string | undefined,
  isExtension: boolean,
): FinishAnswer[] {
  if (!fs.existsSync(finishJsonPath) || answersFile || isExtension) return [];
  const existing = JSON.parse(fs.readFileSync(finishJsonPath, "utf8")) as FinishRecord;
  const existingAnswers = normalizeFinishAnswers(existing.answers);
  if (!allQuestionsAnswered(questionsRecord.questions, existingAnswers)) return [];
  console.log("Reusing saved answers.");
  return existingAnswers;
}

async function collectRoundAnswers(
  options: FinalOptions,
  questionsRecord: FinishQuestionsRecord,
  isExtension: boolean,
  priorFinish: ReturnType<typeof latestFinish>,
  priorQa: { question: string; answer: string }[],
  questionsToAsk: string[],
): Promise<FinishAnswer[]> {
  if (isExtension) {
    let message = `Continuing from finish ${priorFinish?.file} — ${priorQa.length} prior Q&A`;
    if (questionsToAsk.length > 0) {
      message += `, ${questionsToAsk.length} new question(s)`;
    }
    console.log(`${message}.`);
  }
  if (options.answersFile) {
    return readFinishAnswersFile(options.answersFile, questionsRecord.questions);
  }
  if (questionsRecord.questions.length === 0) {
    console.log("All prepared questions already answered — regenerating narrative only.");
    return [];
  }
  console.log("\nAnswer the questions:");
  return collectFinishAnswers(
    questionsRecord.questions,
    inquirer.prompt,
    questionAnalysesForRecord(questionsRecord),
    questionsRecord,
  );
}

interface FinalNarratives {
  impactHistory: string;
  narrative: string[];
  cvBullets: string[];
}

interface FinalNarrativeLlm {
  baseUrl: string;
  model: string;
  provider: LlmProviderId;
  projectBlock: string;
  tracker: TokenUsageTracker;
}

interface FinalNarrativeInput {
  prepared: PreparedRecord;
  project: NonNullable<ReturnType<typeof loadProjectContext>>;
  qa: { question: string; answer: string }[];
  isExtension: boolean;
  priorFinish: ReturnType<typeof latestFinish>;
  llm: FinalNarrativeLlm;
}

async function generateFinalNarratives(input: FinalNarrativeInput): Promise<FinalNarratives> {
  const { prepared, project, qa, isExtension, priorFinish, llm } = input;
  const { baseUrl, model, provider, projectBlock, tracker } = llm;
  process.stdout.write(
    isExtension
      ? "Refining Your IMPACT with all answers ... "
      : "Refining Your IMPACT with answers ... ",
  );
  const impactPrompt =
    isExtension && priorFinish
      ? buildDeepenImpactNarrativePrompt(prepared.model.history, priorFinish.record.history, qa)
      : buildImpactNarrativePrompt(prepared.model.history, qa);
  const refined = (await chatJson({
    provider,
    baseUrl,
    model,
    system: withProjectContext(projectBlock, IMPACT_NARRATIVE_SYSTEM),
    user: impactPrompt,
    schema: groupHistoryJsonSchema(),
    tracker,
  })) as { history?: string };
  const impactHistory = refined.history?.trim() || prepared.model.history;
  console.log("ok");

  process.stdout.write("Writing Role Narrative ... ");
  const result = (await chatJson({
    provider,
    baseUrl,
    model,
    system: withProjectContext(projectBlock, ROLE_NARRATIVE_SYSTEM),
    user: buildRoleNarrativePrompt(
      impactHistory,
      signalReasonArrayTexts(prepared.model.signalReasons),
      qa,
    ),
    schema: roleNarrativeJsonSchema(),
    tracker,
  })) as { narrative?: unknown };
  const narrative = asStringArray(result.narrative).slice(0, 4);
  console.log(`ok (${narrative.length} bullets)`);

  process.stdout.write("Writing CV bullets ... ");
  const cvResult = (await chatJson({
    provider,
    baseUrl,
    model,
    system: withProjectContext(projectBlock, CV_BULLETS_SYSTEM),
    user: buildCvBulletsPrompt(
      project.role,
      impactHistory,
      signalReasonArrayTexts(prepared.model.signalReasons),
      qa,
      narrative,
    ),
    schema: cvBulletsJsonSchema(),
    tracker,
  })) as { cvBullets?: unknown };
  const cvBullets = asStringArray(cvResult.cvBullets).slice(0, 4);
  console.log(`ok (${cvBullets.length} bullets)`);
  return { impactHistory, narrative, cvBullets };
}

function buildFinalMarkdown(
  project: NonNullable<ReturnType<typeof loadProjectContext>>,
  prepared: PreparedRecord,
  narratives: FinalNarratives,
  qa: { question: string; answer: string }[],
): string {
  const role = project.role;
  const p = project.profile;
  const context = [p.domains.join(", "), p.apparentStack.join(", ")].filter(Boolean).join(" · ");
  return [
    "## PROJECT DESCRIPTION",
    "",
    p.summary || "(no summary)",
    context ? `\n_${context}_` : "",
    "",
    `## Your IMPACT as ${role}`,
    "",
    narratives.impactHistory || "(no history)",
    "",
    "## Technologies",
    "",
    prepared.model.technologies.length > 0 ? prepared.model.technologies.join(", ") : "(none)",
    "",
    "## Impact bullet points (Role Narrative)",
    "",
    ...(narratives.narrative.length > 0 ? narratives.narrative.map((b) => `- ${b}`) : ["- (none)"]),
    "",
    "## CV bullets",
    "",
    ...(narratives.cvBullets.length > 0 ? narratives.cvBullets.map((b) => `- ${b}`) : ["- (none)"]),
    "",
    "## Possible questions",
    "",
    ...qa.flatMap((x) => [`**Q:** ${x.question}`, `**A:** ${x.answer || "(no answer)"}`, ""]),
  ].join("\n");
}

interface FinalPreparedState {
  finishDir: string;
  priorFinish: ReturnType<typeof latestFinish>;
  isExtension: boolean;
  archive: FinishArchive;
  questionsPath: string;
  finishJsonPath: string;
  preparedQuestions: string[];
  preparedAnalyses: QuestionAnalyses[];
  questionsToAsk: string[];
  priorQa: { question: string; answer: string }[];
}

function loadFinalProjectContext(
  options: FinalOptions,
): { repoPath: string; project: NonNullable<ReturnType<typeof loadProjectContext>> } | null {
  const repoPath = resolveRepo(options.repo);
  const project = loadProjectContext(repoPath, options.period);
  if (!project) {
    console.error("✖ No project context. Run `dev-workgraph init` first.");
    process.exitCode = 1;
    return null;
  }
  return { repoPath, project };
}

function loadLatestPreparedOrLog(
  repoPath: string,
  period?: string,
): { file: string; record: PreparedRecord } | null {
  const latest = latestPrepared(repoPreparedDir(repoPath, period));
  if (!latest) {
    console.log(
      `No prepared narrative found for ${repoPath}. Run \`dev-workgraph prepare\` first.`,
    );
    return null;
  }
  return latest;
}

function resolvePriorQa(
  isExtension: boolean,
  priorFinish: ReturnType<typeof latestFinish>,
  finishDir: string,
  archive: FinishArchive,
): { question: string; answer: string }[] {
  if (!isExtension || !priorFinish) return [];
  return resolveAnswersToQa(
    finishDir,
    archive.baseFinishId,
    archive.version - 1,
    normalizeFinishAnswers(priorFinish.record.answers),
  );
}

function resolvePriorFinishAnswers(
  isExtension: boolean,
  priorFinish: ReturnType<typeof latestFinish>,
): FinishAnswer[] {
  if (!isExtension || !priorFinish) return [];
  return normalizeFinishAnswers(priorFinish.record.answers);
}

function resolvePriorSourceQuestions(
  isExtension: boolean,
  priorFinish: ReturnType<typeof latestFinish>,
): FinishRecord["sourceQuestions"] | undefined {
  if (!isExtension || !priorFinish) return undefined;
  return priorFinish.record.sourceQuestions;
}

function prepareFinalPreparedState(
  repoPath: string,
  latest: { file: string; record: PreparedRecord },
  prepared: PreparedRecord,
  period?: string,
): FinalPreparedState {
  const finishDir = repoFinishDir(repoPath, period);
  const priorFinish = latestFinish(finishDir);
  const isExtension = isFinalExtension(latest.file, priorFinish);
  const archive =
    isExtension && priorFinish ? resolveFinishArchive(priorFinish) : initialFinishArchive(prepared);
  const roundAnalyses = resolveRoundQuestionAnalyses(
    finishDir,
    archive.baseFinishId,
    archive.version,
    prepared.model.questionsAnalyses,
  );
  const preparedQuestions = flattenQuestions(roundAnalyses);
  const priorQa = resolvePriorQa(isExtension, priorFinish, finishDir, archive);
  const questionsToAsk = isExtension
    ? questionsNotYetAnswered(preparedQuestions, priorQa)
    : preparedQuestions;
  return {
    finishDir,
    priorFinish,
    isExtension,
    archive,
    questionsPath: path.join(
      finishDir,
      finishQuestionsJsonFileName(archive.baseFinishId, archive.version),
    ),
    finishJsonPath: path.join(finishDir, archive.jsonFile),
    preparedQuestions,
    preparedAnalyses: roundAnalyses,
    questionsToAsk,
    priorQa,
  };
}

async function resolveFinalRoundAnswers(
  options: FinalOptions,
  state: FinalPreparedState,
  questionsRecord: FinishQuestionsRecord,
): Promise<FinishAnswer[]> {
  const saved = loadSavedRoundAnswers(
    state.finishJsonPath,
    questionsRecord,
    options.answersFile,
    state.isExtension,
  );
  if (saved.length > 0) return saved;
  return collectRoundAnswers(
    options,
    questionsRecord,
    state.isExtension,
    state.priorFinish,
    state.priorQa,
    state.questionsToAsk,
  );
}

function mergeFinalQa(
  finishDir: string,
  archive: FinishArchive,
  isExtension: boolean,
  priorFinish: ReturnType<typeof latestFinish>,
  roundAnswers: FinishAnswer[],
): {
  allAnswers: FinishAnswer[];
  sourceQuestions: FinishRecord["sourceQuestions"];
  qa: { question: string; answer: string }[];
} {
  const priorAnswers = resolvePriorFinishAnswers(isExtension, priorFinish);
  const allAnswers = isExtension ? [...priorAnswers, ...roundAnswers] : roundAnswers;
  const sourceQuestions = extendSourceQuestions(
    resolvePriorSourceQuestions(isExtension, priorFinish),
    archive.baseFinishId,
    archive.version,
  );
  const qa = resolveAnswersToQa(
    finishDir,
    archive.baseFinishId,
    archive.version,
    allAnswers,
    sourceQuestions,
  );
  return { allAnswers, sourceQuestions, qa };
}

function resolveFinalOutPath(
  options: FinalOptions,
  repoPath: string,
  isExtension: boolean,
  archive: FinishArchive,
): string {
  if (options.output) return path.resolve(options.output);
  const name = isExtension
    ? versionedReconstructionName(repoPath, archive.version, options.period)
    : defaultReconstructionName(repoPath, options.period);
  return path.join(process.cwd(), name);
}

function buildFinishRecord(input: {
  state: FinalPreparedState;
  latestFile: string;
  prepared: PreparedRecord;
  sourceQuestions: FinishRecord["sourceQuestions"];
  allAnswers: FinishAnswer[];
  narratives: FinalNarratives;
  repoPath: string;
  project: NonNullable<ReturnType<typeof loadProjectContext>>;
  model: string;
  finishMdPath: string;
}): FinishRecord {
  const {
    state,
    latestFile,
    prepared,
    sourceQuestions,
    allAnswers,
    narratives,
    repoPath,
    project,
    model,
    finishMdPath,
  } = input;
  const { archive, isExtension, priorFinish } = state;
  return {
    finishId: archive.baseFinishId,
    sourcePrepared: latestFile,
    sourceReport: prepared.sourceReport,
    sourceQuestions,
    ...(isExtension && priorFinish ? { sourcePreviousFinish: priorFinish.file } : {}),
    version: archive.version,
    round: archive.version,
    project: path.basename(repoPath),
    role: project.role,
    technologies: prepared.model.technologies,
    history: narratives.impactHistory,
    narrative: narratives.narrative,
    cvBullets: narratives.cvBullets,
    answers: allAnswers,
    outputMarkdown: path.basename(finishMdPath),
    provenance: { model, generatedAt: new Date().toISOString() },
  };
}

function persistFinalArtifacts(input: {
  md: string;
  outPath: string;
  state: FinalPreparedState;
  qaCount: number;
  finishRecord: FinishRecord;
}): void {
  const { md, outPath, state, qaCount, finishRecord } = input;
  const { finishDir, finishJsonPath, archive, isExtension } = state;
  fs.writeFileSync(outPath, `${md}\n`, "utf8");
  console.log(
    `\n✅ Wrote ${outPath}` +
      (isExtension ? ` (${qaCount} Q&A pairs, finish v${archive.version})` : ""),
  );
  fs.mkdirSync(finishDir, { recursive: true });
  const finishMdPath = path.join(finishDir, archive.mdFile);
  fs.writeFileSync(finishMdPath, `${md}\n`, "utf8");
  writeRecordJson(finishJsonPath, finishRecord);
  console.log(`✅ Archived to ${finishDir} (${finishJsonPath})`);
}

/**
 * Closes the loop: collect human answers to the prepared questions, produce a
 * Role Narrative, and write RECONSTRUCTION.<project>.md to the current directory.
 * @param options - Resolved command options.
 */
export async function final(options: FinalOptions): Promise<void> {
  const loaded = loadFinalProjectContext(options);
  if (!loaded) return;
  const { repoPath, project } = loaded;

  const latest = loadLatestPreparedOrLog(repoPath, options.period);
  if (!latest) return;

  const prepared = latest.record;
  const state = prepareFinalPreparedState(repoPath, latest, prepared, options.period);
  const questionsRecord = ensureQuestionsRecord(
    state.finishDir,
    state.questionsPath,
    state.archive,
    prepared,
    state.isExtension,
    state.questionsToAsk,
    state.preparedAnalyses,
  );

  const roundAnswers = await resolveFinalRoundAnswers(options, state, questionsRecord);
  const { allAnswers, sourceQuestions, qa } = mergeFinalQa(
    state.finishDir,
    state.archive,
    state.isExtension,
    state.priorFinish,
    roundAnswers,
  );

  const { providerId, baseUrl, model } = await resolveLlmSlot("narrative", {
    ollama: options.ollama,
    lmstudio: options.lmstudio,
    model: options.model,
    message: "Which model should write the Role Narrative?",
  });

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("final");
  let narratives: FinalNarratives;
  try {
    narratives = await generateFinalNarratives({
      prepared,
      project,
      qa,
      isExtension: state.isExtension,
      priorFinish: state.priorFinish,
      llm: {
        baseUrl,
        model,
        provider: providerId,
        projectBlock: projectContextBlock(project),
        tracker,
      },
    });
  } finally {
    tracker.endStep();
  }

  const md = buildFinalMarkdown(project, prepared, narratives, qa);
  const outPath = resolveFinalOutPath(options, repoPath, state.isExtension, state.archive);
  const finishMdPath = path.join(state.finishDir, state.archive.mdFile);
  const finishRecord = buildFinishRecord({
    state,
    latestFile: latest.file,
    prepared,
    sourceQuestions,
    allAnswers,
    narratives,
    repoPath,
    project,
    model,
    finishMdPath,
  });
  persistFinalArtifacts({ md, outPath, state, qaCount: qa.length, finishRecord });
}
