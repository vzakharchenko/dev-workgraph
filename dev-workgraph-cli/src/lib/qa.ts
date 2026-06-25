// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import type inquirer from "inquirer";
import type { QAPair } from "./records.js";

const QA_ID_RE = /^q(\d+)$/;

/** Normalizes question text for duplicate detection across finish rounds. */
function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Set of normalized question strings already answered in prior rounds. */
function answeredQuestionSet(pairs: Array<{ question: string }>): Set<string> {
  return new Set(pairs.map((p) => normalizeQuestion(p.question)));
}

/** Drops questions whose normalized text already appears in `prior`. */
export function questionsNotYetAnswered(
  questions: string[],
  prior: Array<{ question: string }>,
): string[] {
  const answered = answeredQuestionSet(prior);
  return questions.filter((q) => !answered.has(normalizeQuestion(q)));
}

/** Strips Q&A ids for finish / prepared JSON (legacy `{ question, answer }` shape). */
export function qaPairsToLegacyAnswers(pairs: QAPair[]): { question: string; answer: string }[] {
  return pairs.map(({ question, answer }) => ({ question, answer }));
}

/** Provenance stamped on Q&A pairs when they are first collected. */
export interface QaProvenance {
  sourceFinal: string;
  sourceReport: string;
}

type QAPairInput = Partial<QAPair> & { question: string; answer: string };

function withProvenance(
  pair: { id: string; question: string; answer: string },
  existing: Partial<QAPair>,
  defaults?: QaProvenance,
): QAPair {
  return {
    id: pair.id,
    question: pair.question,
    answer: pair.answer,
    sourceFinal: existing.sourceFinal ?? defaults?.sourceFinal ?? "",
    sourceReport: existing.sourceReport ?? defaults?.sourceReport ?? "",
  };
}

/** Returns the highest numeric suffix among `q1`, `q2`, … ids (0 when none). */
export function maxQaIdNumber(pairs: Array<{ id?: string }>): number {
  let max = 0;
  for (const pair of pairs) {
    const match = QA_ID_RE.exec(pair.id ?? "");
    if (match?.[1]) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max;
}

/**
 * Ensures every pair has a stable `qN` id and provenance. Existing ids and
 * `sourceFinal` / `sourceReport` are preserved; missing fields are backfilled from `defaults`.
 */
export function ensureQaIds(pairs: QAPairInput[], defaults?: QaProvenance): QAPair[] {
  const used = new Set<string>();
  let nextNum = 1;

  for (const pair of pairs) {
    const match = QA_ID_RE.exec(pair.id ?? "");
    if (match?.[1]) nextNum = Math.max(nextNum, Number.parseInt(match[1], 10) + 1);
  }

  return pairs.map((pair) => {
    if (pair.id && QA_ID_RE.test(pair.id) && !used.has(pair.id)) {
      used.add(pair.id);
      return withProvenance(
        { id: pair.id, question: pair.question, answer: pair.answer },
        pair,
        defaults,
      );
    }
    while (used.has(`q${nextNum}`)) nextNum += 1;
    const id = `q${nextNum}`;
    used.add(id);
    nextNum += 1;
    return withProvenance({ id, question: pair.question, answer: pair.answer }, pair, defaults);
  });
}

/** Assigns fresh ids continuing after `after` (used for a new finish / deepen round). */
export function newQaPairs(
  entries: Array<{ question: string; answer: string }>,
  after: QAPair[],
  provenance: QaProvenance,
): QAPair[] {
  let nextNum = maxQaIdNumber(after) + 1;
  return entries.map(({ question, answer }) => ({
    id: `q${nextNum++}`,
    question,
    answer,
    sourceFinal: provenance.sourceFinal,
    sourceReport: provenance.sourceReport,
  }));
}

/** Loads Q&A from JSON (array or `{ answers: [...] }`), assigning ids after `after`. */
export function readAnswersFile(
  filePath: string,
  questions: string[],
  after: QAPair[] = [],
  provenance: QaProvenance,
): QAPair[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { answers?: unknown }).answers ?? []);
  const entries = (arr as Array<{ id?: string; question?: string; answer?: string }>).map(
    (x, i) => ({
      question: x.question ?? questions[i] ?? `Question ${i + 1}`,
      answer: x.answer ?? "",
    }),
  );
  return newQaPairs(entries, after, provenance);
}

/** Collects answers interactively, one question at a time (multi-line editor). */
export async function collectAnswersInteractive(
  questions: string[],
  after: QAPair[],
  prompt: typeof inquirer.prompt,
  provenance: QaProvenance,
): Promise<QAPair[]> {
  let nextNum = maxQaIdNumber(after) + 1;
  const pairs: QAPair[] = [];
  for (const [i, question] of questions.entries()) {
    const { answer } = await prompt<{ answer: string }>([
      {
        type: "editor",
        name: "answer",
        message: `(${i + 1}/${questions.length}) ${question}`,
      },
    ]);
    pairs.push({
      id: `q${nextNum++}`,
      question,
      answer: (answer ?? "").trim(),
      sourceFinal: provenance.sourceFinal,
      sourceReport: provenance.sourceReport,
    });
  }
  return pairs;
}
