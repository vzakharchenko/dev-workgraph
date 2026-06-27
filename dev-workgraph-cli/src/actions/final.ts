// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import { loadConfig, repoFinishDir, repoPreparedDir, setOllamaConfig } from "../lib/config.js";
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
  questionsNotYetAnswered,
  readFinishAnswersFile,
  resolveAnswersToQa,
  writeFinishQuestions,
} from "../lib/finish-questions.js";
import { resolveRepo } from "../lib/git.js";
import {
  cvBulletsJsonSchema,
  flattenQuestions,
  groupHistoryJsonSchema,
  roleNarrativeJsonSchema,
} from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
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
import { resolveModel } from "../lib/select.js";
import { TokenUsageTracker } from "../lib/token-usage.js";

/**
 * Options for the `final` command.
 */
export interface FinalOptions {
  /** Path to the repository. */
  repo: string;
  /** Pre-written Q&A as JSON (non-interactive). */
  answersFile?: string;
  /** Output markdown path (default: ./RECONSTRUCTION.<project>.md). */
  output?: string;
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

/**
 * Closes the loop: collect human answers to the prepared questions, produce a
 * Role Narrative, and write RECONSTRUCTION.<project>.md to the current directory.
 * @param options - Resolved command options.
 */
export async function final(options: FinalOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);

  const project = loadProjectContext(repoPath, options.period);
  if (!project) {
    console.error("✖ No project context. Run `dev-workgraph init` first.");
    process.exitCode = 1;
    return;
  }

  const preparedDir = repoPreparedDir(repoPath, options.period);
  const latest = latestPrepared(preparedDir);
  if (!latest) {
    console.log(
      `No prepared narrative found for ${repoPath}. Run \`dev-workgraph prepare\` first.`,
    );
    return;
  }
  const prepared = latest.record;

  const finishDir = repoFinishDir(repoPath, options.period);
  const priorFinish = latestFinish(finishDir);
  const isExtension =
    priorFinish !== null &&
    (priorFinish.record.answers?.length ?? 0) > 0 &&
    latest.file !== priorFinish.record.sourcePrepared;

  const archive =
    isExtension && priorFinish
      ? nextFinishVersion(priorFinish.file)
      : {
          baseFinishId: prepared.preparedId,
          version: 1,
          jsonFile: finishJsonFileName(prepared.preparedId, 1),
          mdFile: finishMdFileName(prepared.preparedId, 1),
        };

  const questionsJsonFile = finishQuestionsJsonFileName(archive.baseFinishId, archive.version);
  const questionsPath = path.join(finishDir, questionsJsonFile);
  const finishJsonPath = path.join(finishDir, archive.jsonFile);

  const preparedQuestions = flattenQuestions(prepared.model.questionsAnalyses).slice(0, 4);
  const priorQa =
    isExtension && priorFinish
      ? resolveAnswersToQa(
          finishDir,
          archive.baseFinishId,
          archive.version - 1,
          normalizeFinishAnswers(priorFinish.record.answers),
        )
      : [];

  const questionsToAsk = isExtension
    ? questionsNotYetAnswered(preparedQuestions, priorQa)
    : preparedQuestions;

  let questionsRecord: FinishQuestionsRecord;
  if (fs.existsSync(questionsPath)) {
    questionsRecord = loadFinishQuestions(questionsPath);
  } else {
    const texts = isExtension ? questionsToAsk : preparedQuestions;
    questionsRecord = createFinishQuestions(texts, {
      sourceFinal: archive.jsonFile,
      sourceReport: prepared.sourceReport,
    });
    fs.mkdirSync(finishDir, { recursive: true });
    writeFinishQuestions(questionsPath, questionsRecord);
  }

  let roundAnswers: FinishAnswer[] = [];
  if (fs.existsSync(finishJsonPath) && !options.answersFile && !isExtension) {
    const existing = JSON.parse(fs.readFileSync(finishJsonPath, "utf8")) as FinishRecord;
    const existingAnswers = normalizeFinishAnswers(existing.answers);
    if (allQuestionsAnswered(questionsRecord.questions, existingAnswers)) {
      console.log("Reusing saved answers.");
      roundAnswers = existingAnswers;
    }
  }

  if (roundAnswers.length === 0) {
    if (isExtension) {
      console.log(
        `Continuing from finish ${priorFinish?.file} — ${priorQa.length} prior Q&A` +
          `${questionsToAsk.length > 0 ? `, ${questionsToAsk.length} new question(s)` : ""}.`,
      );
    }
    if (options.answersFile) {
      roundAnswers = readFinishAnswersFile(options.answersFile, questionsRecord.questions);
    } else if (questionsRecord.questions.length === 0) {
      console.log("All prepared questions already answered — regenerating narrative only.");
      roundAnswers = [];
    } else {
      console.log("\nAnswer the questions:");
      roundAnswers = await collectFinishAnswers(questionsRecord.questions, inquirer.prompt);
    }
  }

  const priorAnswers =
    isExtension && priorFinish ? normalizeFinishAnswers(priorFinish.record.answers) : [];
  const allAnswers = isExtension ? [...priorAnswers, ...roundAnswers] : roundAnswers;
  const sourceQuestions = extendSourceQuestions(
    isExtension && priorFinish ? priorFinish.record.sourceQuestions : undefined,
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

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should write the Role Narrative?",
    saved: savedOllama?.narrativeModel ?? savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, narrativeModel: model });

  const projectBlock = projectContextBlock(project);

  const tracker = new TokenUsageTracker(repoPath, options.period);
  tracker.beginStep("final");

  let impactHistory = prepared.model.history;
  let narrative: string[] = [];
  let cvBullets: string[] = [];

  try {
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
      baseUrl,
      model,
      system: withProjectContext(projectBlock, IMPACT_NARRATIVE_SYSTEM),
      user: impactPrompt,
      schema: groupHistoryJsonSchema(),
      tracker,
    })) as { history?: string };
    impactHistory = refined.history?.trim() || prepared.model.history;
    console.log("ok");

    process.stdout.write("Writing Role Narrative ... ");
    const result = (await chatJson({
      baseUrl,
      model,
      system: withProjectContext(projectBlock, ROLE_NARRATIVE_SYSTEM),
      user: buildRoleNarrativePrompt(impactHistory, prepared.model.signalReasons, qa),
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
        prepared.model.signalReasons,
        qa,
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

  const projectName = path.basename(repoPath);
  const role = project.role;
  const p = project.profile;
  const context = [p.domains.join(", "), p.apparentStack.join(", ")].filter(Boolean).join(" · ");

  const md = [
    "## PROJECT DESCRIPTION",
    "",
    p.summary || "(no summary)",
    context ? `\n_${context}_` : "",
    "",
    `## Your IMPACT as ${role}`,
    "",
    impactHistory || "(no history)",
    "",
    "## Technologies",
    "",
    prepared.model.technologies.length > 0 ? prepared.model.technologies.join(", ") : "(none)",
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
  ].join("\n");

  const outPath = options.output
    ? path.resolve(options.output)
    : path.join(
        process.cwd(),
        isExtension
          ? versionedReconstructionName(repoPath, archive.version, options.period)
          : defaultReconstructionName(repoPath, options.period),
      );
  fs.writeFileSync(outPath, `${md}\n`, "utf8");
  console.log(
    `\n✅ Wrote ${outPath}` +
      (isExtension ? ` (${qa.length} Q&A pairs, finish v${archive.version})` : ""),
  );

  fs.mkdirSync(finishDir, { recursive: true });
  const finishMdPath = path.join(finishDir, archive.mdFile);
  fs.writeFileSync(finishMdPath, `${md}\n`, "utf8");

  const finishRecord: FinishRecord = {
    finishId: archive.baseFinishId,
    sourcePrepared: latest.file,
    sourceReport: prepared.sourceReport,
    sourceQuestions,
    ...(isExtension && priorFinish ? { sourcePreviousFinish: priorFinish.file } : {}),
    version: archive.version,
    round: archive.version,
    project: projectName,
    role,
    technologies: prepared.model.technologies,
    history: impactHistory,
    narrative,
    cvBullets,
    answers: allAnswers,
    outputMarkdown: path.basename(finishMdPath),
    provenance: { model, generatedAt: new Date().toISOString() },
  };
  writeRecordJson(finishJsonPath, finishRecord);
  console.log(`✅ Archived to ${finishDir} (${finishJsonPath})`);
}
