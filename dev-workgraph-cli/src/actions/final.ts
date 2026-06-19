// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import { loadConfig, repoFinishDir, repoPreparedDir, setOllamaConfig } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { groupHistoryJsonSchema, roleNarrativeJsonSchema } from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { loadProjectContext } from "../lib/project.js";
import {
  buildImpactNarrativePrompt,
  buildRoleNarrativePrompt,
  IMPACT_NARRATIVE_SYSTEM,
  projectContextBlock,
  ROLE_NARRATIVE_SYSTEM,
  withProjectContext,
} from "../lib/prompts.js";
import type { FinishRecord, PreparedRecord } from "../lib/records.js";
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
  /** Re-collect answers and overwrite the markdown file. */
  force?: boolean;
  /** Operate on a defined review period's data instead of the repo's all-time data. */
  period?: string;
}

interface QA {
  question: string;
  answer: string;
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

/** Loads Q&A from a JSON file (accepts an array or `{ answers: [...] }`). */
function readAnswersFile(p: string, questions: string[]): QA[] {
  const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { answers?: unknown }).answers ?? []);
  return (arr as { question?: string; answer?: string }[]).map((x, i) => ({
    question: x.question ?? questions[i] ?? `Question ${i + 1}`,
    answer: x.answer ?? "",
  }));
}

/** Collects answers interactively, one question at a time (multi-line editor). */
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
  const questions = prepared.model.questions;

  // Step 1 — collect (or reuse) answers.
  let qa: QA[];
  if (options.answersFile) {
    qa = readAnswersFile(options.answersFile, questions);
  } else if (prepared.answers && prepared.answers.length > 0 && !options.force) {
    console.log("Reusing saved answers (pass --force to re-answer).");
    qa = prepared.answers;
  } else {
    qa = await collectAnswers(questions);
  }

  // Persist Q&A in-place on the prepared record.
  prepared.answers = qa;
  prepared.answeredAt = new Date().toISOString();
  fs.writeFileSync(preparedPath, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");

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
  process.stdout.write("Refining Your IMPACT with answers ... ");
  const refined = (await chatJson({
    baseUrl,
    model,
    system: withProjectContext(projectBlock, IMPACT_NARRATIVE_SYSTEM),
    user: buildImpactNarrativePrompt(prepared.model.history, qa),
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

  // Period results get a suffixed filename so a year review never overwrites the
  // repo's all-time RECONSTRUCTION.<project>.md.
  const defaultName = options.period
    ? `RECONSTRUCTION.${projectName}.${options.period}.md`
    : `RECONSTRUCTION.${projectName}.md`;
  const outPath = options.output
    ? path.resolve(options.output)
    : path.join(process.cwd(), defaultName);
  fs.writeFileSync(outPath, `${md}\n`, "utf8");
  console.log(`\n✅ Wrote ${outPath}`);

  // Step 4 — archive the result under the repo's finish dir: a copy of the
  // markdown plus a JSON record that links back to the source prepared file.
  const finishDir = repoFinishDir(repoPath, options.period);
  fs.mkdirSync(finishDir, { recursive: true });
  const finishMdPath = path.join(finishDir, `${prepared.preparedId}.md`);
  const finishJsonPath = path.join(finishDir, `${prepared.preparedId}.json`);
  fs.writeFileSync(finishMdPath, `${md}\n`, "utf8");

  const finishRecord: FinishRecord = {
    finishId: prepared.preparedId,
    sourcePrepared: latest.file,
    sourceReport: prepared.sourceReport,
    project: projectName,
    role,
    technologies: prepared.model.technologies,
    history: impactHistory,
    narrative,
    answers: qa,
    outputMarkdown: path.basename(finishMdPath),
    provenance: { model, generatedAt: new Date().toISOString() },
  };
  fs.writeFileSync(finishJsonPath, `${JSON.stringify(finishRecord, null, 2)}\n`, "utf8");
  console.log(`✅ Archived to ${finishDir}`);
}
