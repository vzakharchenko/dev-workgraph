// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import { loadConfig, repoFinishDir, repoPreparedDir, setOllamaConfig } from "../lib/config.js";
import {
  defaultReconstructionName,
  finishJsonFileName,
  finishMdFileName,
  latestFinish,
  nextFinishVersion,
  versionedReconstructionName,
} from "../lib/finish-load.js";
import { resolveRepo } from "../lib/git.js";
import { flattenQuestions, groupHistoryJsonSchema, roleNarrativeJsonSchema } from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildDeepenImpactNarrativePrompt,
  buildImpactNarrativePrompt,
  buildRoleNarrativePrompt,
  IMPACT_NARRATIVE_SYSTEM,
  projectContextBlock,
  ROLE_NARRATIVE_SYSTEM,
  withProjectContext,
} from "../lib/prompts.js";
import {
  collectAnswersInteractive,
  ensureQaIds,
  qaPairsToLegacyAnswers,
  questionsNotYetAnswered,
  readAnswersFile,
} from "../lib/qa.js";
import { writeRecordJson } from "../lib/record-io.js";
import type { FinishRecord, PreparedRecord, QAPair } from "../lib/records.js";
import { resolveModel } from "../lib/select.js";

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
  const preparedPath = path.join(preparedDir, latest.file);

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

  const provenance = {
    sourceFinal: archive.jsonFile,
    sourceReport: prepared.sourceReport,
  };

  const preparedQuestions = flattenQuestions(prepared.model.questionsAnalyses).slice(0, 4);
  const priorQa: QAPair[] =
    isExtension && priorFinish
      ? ensureQaIds(priorFinish.record.answers, {
          sourceFinal: priorFinish.file,
          sourceReport: priorFinish.record.sourceReport,
        })
      : [];

  const questionsToAsk = isExtension
    ? questionsNotYetAnswered(preparedQuestions, priorQa)
    : preparedQuestions;

  // Step 1 — collect (or reuse) answers.
  let allQa: QAPair[];
  if (isExtension) {
    console.log(
      `Continuing from finish ${priorFinish?.file} — ${priorQa.length} prior Q&A` +
        `${questionsToAsk.length > 0 ? `, ${questionsToAsk.length} new question(s)` : ""}.`,
    );
    let newQa: QAPair[];
    if (options.answersFile) {
      newQa = readAnswersFile(options.answersFile, questionsToAsk, priorQa, provenance);
    } else if (questionsToAsk.length === 0) {
      console.log("All prepared questions already answered — regenerating narrative only.");
      newQa = [];
    } else {
      console.log("\nAnswer the new questions:");
      newQa = await collectAnswersInteractive(questionsToAsk, priorQa, inquirer.prompt, provenance);
    }
    allQa = [...priorQa, ...newQa];
  } else if (options.answersFile) {
    allQa = readAnswersFile(options.answersFile, preparedQuestions, [], provenance);
  } else if (prepared.answers && prepared.answers.length > 0) {
    console.log("Reusing saved answers.");
    allQa = ensureQaIds(prepared.answers, provenance);
  } else {
    allQa = await collectAnswersInteractive(preparedQuestions, [], inquirer.prompt, provenance);
  }

  const qa = qaPairsToLegacyAnswers(allQa);

  // Persist cumulative Q&A on the prepared record.
  prepared.answers = qa;
  prepared.answeredAt = new Date().toISOString();
  writeRecordJson(preparedPath, prepared);

  // Step 2 — Role Narrative (one LLM session, reportModel).
  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should write the Role Narrative?",
    saved: savedOllama?.narrativeModel ?? savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, narrativeModel: model });

  const projectBlock = projectContextBlock(project);

  // Step 2a — refine "Your IMPACT" prose so it reflects the human's answers, not
  // just the Git reconstruction. Falls back to the prepared history on failure.
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
  })) as { history?: string };
  const impactHistory = refined.history?.trim() || prepared.model.history;
  console.log("ok");

  // Step 2b — Role Narrative bullets.
  process.stdout.write("Writing Role Narrative ... ");
  const result = (await chatJson({
    baseUrl,
    model,
    system: withProjectContext(projectBlock, ROLE_NARRATIVE_SYSTEM),
    user: buildRoleNarrativePrompt(impactHistory, prepared.model.signalReasons, qa),
    schema: roleNarrativeJsonSchema(),
  })) as { narrative?: unknown };
  const narrative = asStringArray(result.narrative).slice(0, 4);
  console.log(`ok (${narrative.length} bullets)`);

  // Step 3 — assemble RECONSTRUCTION.<project>.md in the current working directory.
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

  // Step 4 — archive the result under the repo's finish dir.
  fs.mkdirSync(finishDir, { recursive: true });
  const finishMdPath = path.join(finishDir, archive.mdFile);
  const finishJsonPath = path.join(finishDir, archive.jsonFile);
  fs.writeFileSync(finishMdPath, `${md}\n`, "utf8");

  const finishRecord: FinishRecord = {
    finishId: archive.baseFinishId,
    sourcePrepared: latest.file,
    sourceReport: prepared.sourceReport,
    ...(isExtension && priorFinish ? { sourcePreviousFinish: priorFinish.file } : {}),
    version: archive.version,
    round: archive.version,
    project: projectName,
    role,
    technologies: prepared.model.technologies,
    history: impactHistory,
    narrative,
    answers: qa,
    outputMarkdown: path.basename(finishMdPath),
    provenance: { model, generatedAt: new Date().toISOString() },
  };
  writeRecordJson(finishJsonPath, finishRecord);
  console.log(`✅ Archived to ${finishDir} (${finishJsonPath})`);
}
