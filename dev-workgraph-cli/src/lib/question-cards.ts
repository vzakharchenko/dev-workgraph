// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { LlmProviderId } from "./llm/types.js";
import type { QuestionAnalyses } from "./model.js";
import { prepareEvidenceJsonSchema } from "./model.js";
import { chatJson } from "./ollama.js";
import {
  buildPrepareEvidencePrompt,
  PREPARE_EVIDENCE_SYSTEM,
  withProjectContext,
} from "./prompts.js";
import type { TokenUsageTracker } from "./token-usage.js";

const MAX_EVIDENCE_BULLETS = 4;
const MAX_BULLET_CHARS = 220;

function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordOverlapScore(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  const words = (text: string) =>
    new Set(
      text
        .split(/\W+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 3),
    );
  const aWords = words(left);
  const bWords = words(right);
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let shared = 0;
  for (const word of aWords) {
    if (bWords.has(word)) shared += 1;
  }
  return shared / Math.max(aWords.size, bWords.size);
}

/** Strips third-person narrative prefixes from observation lines. */
export function dryObservationLine(line: string): string {
  return line
    .trim()
    .replace(/^The developer\s+/i, "")
    .replace(/^Developer\s+/i, "")
    .replace(/^They\s+/i, "I ")
    .trim();
}

/** Removes performance-review phrasing from question strings (post-LLM safety net). */
export function normalizeQuestionText(text: string): string {
  let q = text.trim();
  q = q.replace(/^As an?\s+(Staff|Principal|Senior|Junior|Lead)\s+Developer,?\s+/i, "");
  q = q.replace(/^From a platform direction perspective,?\s+/i, "");
  q = q.replace(/\bsame-time\b/gi, "at the same time");
  q = q.replace(/\bsame-time users\b/gi, "existing users");
  return q.trim();
}

function anchorText(thread: QuestionAnalyses): string {
  return [...thread.question, ...thread.missingPiece].join(" ");
}

/** Picks up to {@link MAX_EVIDENCE_BULLETS} observation lines most relevant to the question. */
export function pickEvidenceObservations(thread: QuestionAnalyses): string[] {
  const candidates = uniq(thread.observation.map(dryObservationLine).filter(Boolean));
  if (candidates.length === 0) return [];

  const anchor = anchorText(thread);
  const scored = candidates
    .map((line, index) => ({
      line,
      score: wordOverlapScore(line, anchor) + (candidates.length - index) * 0.001,
    }))
    .sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  for (const row of scored) {
    if (picked.length >= MAX_EVIDENCE_BULLETS) break;
    const dup = picked.some(
      (existing) =>
        wordOverlapScore(existing, row.line) >= 0.75 ||
        existing.includes(row.line) ||
        row.line.includes(existing),
    );
    if (!dup) picked.push(row.line);
  }
  return picked;
}

function commitPrefixList(thread: QuestionAnalyses, max = 4): string[] {
  return uniq((thread.sourceCommits ?? []).map((h) => h.slice(0, 8)).filter(Boolean)).slice(0, max);
}

/** Formats bullets + optional commit line for storage / CLI. */
export function formatEvidenceExcerpt(bullets: string[], commits: string[]): string | undefined {
  const lines: string[] = [];
  for (const bullet of bullets.slice(0, MAX_EVIDENCE_BULLETS)) {
    const text = truncate(bullet, MAX_BULLET_CHARS);
    if (text) lines.push(`- ${text}`);
  }
  if (commits.length > 0) {
    lines.push(`Related commits: ${commits.join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Thread-specific deterministic evidence from observations + commits (not group hiContext). */
export function buildEvidenceExcerpt(thread: QuestionAnalyses): string | undefined {
  const bullets = pickEvidenceObservations(thread);
  const commits = commitPrefixList(thread);
  if (bullets.length === 0 && commits.length === 0) return undefined;
  return formatEvidenceExcerpt(bullets, commits);
}

/** Neutral one-liner from {@link QuestionAnalyses.missingPiece} — never role-coaching. */
export function buildWhyAsked(thread: QuestionAnalyses): string | undefined {
  const missing = thread.missingPiece.map((line) => line.trim()).filter(Boolean);
  if (missing.length === 0) return undefined;
  const gap = missing.length === 1 ? (missing[0] ?? "") : missing.join("; ");
  return `Git cannot establish this from the evidence alone: ${gap}`;
}

function sanitizeThreadCards(thread: QuestionAnalyses): QuestionAnalyses {
  const observation = thread.observation.map(dryObservationLine).filter(Boolean);
  const question = thread.question.map(normalizeQuestionText).filter(Boolean);
  return { ...thread, observation, question };
}

/**
 * Attaches {@link QuestionAnalyses.evidenceExcerpt} and {@link QuestionAnalyses.whyAsked}
 * (deterministic; evidence from thread observations, not group metadata).
 */
export function enrichQuestionCards(threads: QuestionAnalyses[]): QuestionAnalyses[] {
  return threads.map((thread) => {
    const sanitized = sanitizeThreadCards(thread);
    return {
      ...sanitized,
      evidenceExcerpt: buildEvidenceExcerpt(sanitized),
      whyAsked: buildWhyAsked(sanitized),
    };
  });
}

function isValidPolishedExcerpt(value: string): boolean {
  const lines = value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_EVIDENCE_BULLETS + 1) return false;
  const bulletCount = lines.filter((l) => l.startsWith("- ")).length;
  if (bulletCount < 1 || bulletCount > MAX_EVIDENCE_BULLETS) return false;
  const nonBullets = lines.filter((l) => !l.startsWith("- "));
  if (nonBullets.length > 1) return false;
  if (nonBullets.length === 1 && !nonBullets[0]?.startsWith("Related commits:")) return false;
  return true;
}

/**
 * Optional LLM pass: compress thread observations into 3–4 scannable bullets per card.
 * Falls back to existing deterministic excerpts on failure or invalid output.
 */
export async function polishEvidenceExcerptsWithLlm(input: {
  threads: QuestionAnalyses[];
  provider: LlmProviderId;
  baseUrl: string;
  model: string;
  projectBlock: string;
  tracker?: TokenUsageTracker;
}): Promise<QuestionAnalyses[]> {
  const { threads, provider, baseUrl, model, projectBlock, tracker } = input;
  if (threads.length === 0) return threads;

  const raw = (await chatJson({
    provider,
    baseUrl,
    model,
    system: withProjectContext(projectBlock, PREPARE_EVIDENCE_SYSTEM),
    user: buildPrepareEvidencePrompt(threads),
    schema: prepareEvidenceJsonSchema(threads.length),
    tracker,
  })) as { evidenceExcerpts?: unknown };

  const excerpts = Array.isArray(raw.evidenceExcerpts)
    ? raw.evidenceExcerpts.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    : [];

  if (excerpts.length !== threads.length) return threads;

  return threads.map((thread, index) => {
    const polished = excerpts[index]?.trim();
    const fallback = thread.evidenceExcerpt ?? buildEvidenceExcerpt(thread);
    if (!polished || !isValidPolishedExcerpt(polished)) {
      return { ...thread, evidenceExcerpt: fallback };
    }
    return { ...thread, evidenceExcerpt: polished };
  });
}

function evidenceDisplayLines(excerpt: string): string[] {
  return excerpt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function primaryQuestionText(thread: QuestionAnalyses): string {
  return thread.question[0]?.trim() || thread.question.join(" ").trim();
}

/** CLI lines for one question card (prepare preview / final prompt). */
export function formatQuestionCardLines(
  thread: QuestionAnalyses,
  index: number,
  total: number,
): string[] {
  const lines: string[] = [`Q${index + 1}/${total}`];
  if (thread.sourceGroupId !== undefined) {
    lines.push(`Source: Work session ${thread.sourceGroupId}`);
  } else if (thread.sourceGroupIds?.length) {
    lines.push(`Source: Work sessions ${thread.sourceGroupIds.join(", ")}`);
  } else if (
    thread.lineageKind === "signal-reason" &&
    thread.derivedFromSignalReasonIndex !== undefined
  ) {
    lines.push(`Source: Signal reason ${thread.derivedFromSignalReasonIndex + 1}`);
  } else if (thread.derivedFromThreadIds?.length) {
    lines.push(`Source: Report threads ${thread.derivedFromThreadIds.join(", ")}`);
  }
  if (thread.evidenceExcerpt) {
    lines.push("Evidence:");
    for (const line of evidenceDisplayLines(thread.evidenceExcerpt)) {
      lines.push(line.startsWith("- ") ? line : `- ${line}`);
    }
  }
  if (thread.whyAsked) {
    lines.push("Why asked:");
    lines.push(thread.whyAsked);
  }
  const question = primaryQuestionText(thread);
  if (question) {
    lines.push("Question:");
    lines.push(question);
  }
  return lines;
}

/** Prints question cards to stdout. */
export function printQuestionCards(threads: QuestionAnalyses[]): void {
  const total = threads.length;
  threads.forEach((thread, i) => {
    for (const line of formatQuestionCardLines(thread, i, total)) {
      console.log(line);
    }
    if (i < total - 1) console.log("");
  });
}
