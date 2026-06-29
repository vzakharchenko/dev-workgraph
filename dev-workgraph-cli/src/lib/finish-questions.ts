// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type inquirer from "inquirer";
import {
  finishQuestionsJsonFileName,
  normalizeSourceQuestions,
  parseFinishFileName,
  parseFinishQuestionVersionLabel,
} from "./finish-load.js";
import { writeRecordJson } from "./record-io.js";
import type {
  FinishAnswer,
  FinishQuestion,
  FinishQuestionsRecord,
  FinishRecord,
  FinishSourceQuestions,
} from "./records.js";

/** Plain Q&A shape for LLM prompts and markdown assembly. */
export interface ResolvedQa {
  question: string;
  answer: string;
}

/** Legacy finish answer with inline question text. */
interface LegacyFinishAnswer {
  question: string;
  answer: string;
}

function isLegacyAnswer(value: unknown): value is LegacyFinishAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    "question" in value &&
    typeof (value as LegacyFinishAnswer).question === "string"
  );
}

function isFinishAnswer(value: unknown): value is FinishAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    "questionId" in value &&
    typeof (value as FinishAnswer).questionId === "string"
  );
}

/** Creates questions with unique Unix-ms ids (base + index). */
export function createFinishQuestions(
  questionTexts: string[],
  meta: { sourceFinal: string; sourceReport: string },
  baseIdMs = Date.now(),
): FinishQuestionsRecord {
  return {
    sourceFinal: meta.sourceFinal,
    sourceReport: meta.sourceReport,
    questions: questionTexts.map((question, i) => ({
      id: String(baseIdMs + i),
      question,
    })),
  };
}

export function writeFinishQuestions(filePath: string, record: FinishQuestionsRecord): void {
  writeRecordJson(filePath, record);
}

export function loadFinishQuestions(filePath: string): FinishQuestionsRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as FinishQuestionsRecord;
}

/** Loads question files for versions 1…`upToVersion` into one id → text map. */
export function loadQuestionCatalog(
  finishDir: string,
  baseFinishId: number,
  upToVersion: number,
): Map<string, string> {
  const catalog = new Map<string, string>();
  for (let version = 1; version <= upToVersion; version += 1) {
    const file = path.join(finishDir, finishQuestionsJsonFileName(baseFinishId, version));
    if (!fs.existsSync(file)) continue;
    const record = loadFinishQuestions(file);
    for (const q of record.questions) catalog.set(q.id, q.question);
  }
  return catalog;
}

function loadQuestionCatalogFromLabels(
  finishDir: string,
  baseFinishId: number,
  labels: string[],
): Map<string, string> {
  const catalog = new Map<string, string>();
  for (const label of labels) {
    const version = parseFinishQuestionVersionLabel(label);
    const file = path.join(finishDir, finishQuestionsJsonFileName(baseFinishId, version));
    if (!fs.existsSync(file)) continue;
    const record = loadFinishQuestions(file);
    for (const q of record.questions) catalog.set(q.id, q.question);
  }
  return catalog;
}

function loadQuestionCatalogForFinish(
  finishDir: string,
  baseFinishId: number,
  sourceQuestions: FinishSourceQuestions | string | undefined,
  upToVersion: number,
): Map<string, string> {
  const normalized = normalizeSourceQuestions(sourceQuestions);
  const labels = normalized[baseFinishId];
  if (labels?.length) {
    return loadQuestionCatalogFromLabels(finishDir, baseFinishId, labels);
  }
  return loadQuestionCatalog(finishDir, baseFinishId, upToVersion);
}

/** Normalizes on-disk answers (legacy inline or `questionId` references). */
export function normalizeFinishAnswers(raw: unknown[] | undefined): FinishAnswer[] {
  if (!raw?.length) return [];
  if (raw.every(isLegacyAnswer)) {
    const base = Date.now();
    return raw.map((entry, i) => ({
      questionId: String(base + i),
      answer: entry.answer,
    }));
  }
  return raw.filter(isFinishAnswer);
}

/** Resolves answer rows using question files listed in `sourceQuestions` or versions 1…`upToVersion`. */
export function resolveAnswersToQa(
  finishDir: string,
  baseFinishId: number,
  upToVersion: number,
  answers: FinishAnswer[],
  sourceQuestions?: FinishSourceQuestions | string,
): ResolvedQa[] {
  const catalog = loadQuestionCatalogForFinish(
    finishDir,
    baseFinishId,
    sourceQuestions,
    upToVersion,
  );
  return answers.map((entry) => ({
    question: catalog.get(entry.questionId) ?? `(missing question ${entry.questionId})`,
    answer: entry.answer,
  }));
}

/** Resolves finish answers to prompt/markdown Q&A (legacy or question-file backed). */
export function resolveFinishQa(
  finishDir: string,
  record: FinishRecord,
  finishJsonFile: string,
): ResolvedQa[] {
  const raw = (record.answers ?? []) as unknown[];
  if (raw.length > 0 && raw.every(isLegacyAnswer)) {
    return raw.map((entry) => ({ question: entry.question, answer: entry.answer }));
  }
  const { baseFinishId, version } = parseFinishFileName(finishJsonFile);
  return resolveAnswersToQa(
    finishDir,
    baseFinishId,
    version,
    normalizeFinishAnswers(raw),
    record.sourceQuestions,
  );
}

/** Normalizes question text for duplicate detection across finish rounds. */
function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drops questions whose text already appears in resolved prior Q&A. */
export function questionsNotYetAnswered(questions: string[], prior: ResolvedQa[]): string[] {
  const answered = new Set(prior.map((p) => normalizeQuestion(p.question)));
  return questions.filter((q) => !answered.has(normalizeQuestion(q)));
}

/** Collects answers for a question file (interactive editor). */
export async function collectFinishAnswers(
  questions: FinishQuestion[],
  prompt: typeof inquirer.prompt,
): Promise<FinishAnswer[]> {
  const answers: FinishAnswer[] = [];
  for (const [i, q] of questions.entries()) {
    const { answer } = await prompt<{ answer: string }>([
      {
        type: "editor",
        name: "answer",
        message: `(${i + 1}/${questions.length}) ${q.question}`,
      },
    ]);
    answers.push({ questionId: q.id, answer: (answer ?? "").trim() });
  }
  return answers;
}

/** Loads answers from JSON (array or `{ answers: [...] }`) aligned with `questions`. */
export function readFinishAnswersFile(
  filePath: string,
  questions: FinishQuestion[],
): FinishAnswer[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { answers?: unknown }).answers ?? []);
  return (arr as Array<{ questionId?: string; question?: string; answer?: string }>).map(
    (entry, i) => ({
      questionId: entry.questionId ?? questions[i]?.id ?? questions[0]?.id ?? String(Date.now()),
      answer: entry.answer ?? "",
    }),
  );
}

/** True when every question in the file already has a non-empty answer on the finish record. */
export function allQuestionsAnswered(
  questions: FinishQuestion[],
  answers: FinishAnswer[],
): boolean {
  const byId = new Map(answers.map((a) => [a.questionId, a.answer]));
  return questions.every((q) => (byId.get(q.id) ?? "").trim().length > 0);
}
