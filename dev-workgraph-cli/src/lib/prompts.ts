// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0
//
// All LLM-facing prompts live here so the exact wording is easy to find and tune.
// Two flows: per-commit `summarize` and per-session `commit-group`.

import { tierOf } from "./grouping.js";
import type { CommitRecord, GroupRecord } from "./records.js";

/** Max patch characters sent to the per-commit model; longer patches are truncated. */
export const MAX_PATCH_CHARS = 16000;

/** Char budget for the serialized member commits in the group prompt. */
export const MAX_MEMBERS_CHARS = 24000;

// ───────────────────────────── per-commit summarize ─────────────────────────────

export const COMMIT_SUMMARY_SYSTEM = [
  "You are an engineering historian analyzing a single Git commit (metadata + patch)",
  "authored by ONE developer. Return a JSON object describing the change.",
  "Rules:",
  "- summary: describe WHAT changed, in plain language. Describe the change itself,",
  "  NOT its importance, business impact, or whether it shipped to production.",
  "- Never use 'the team', 'they', or imply multiple authors. This is one person's commit.",
  "- Signals are 'low' | 'medium' | 'high' only. technicalSignal = technical depth;",
  "  architectureSignal = effect on structure/boundaries/modules/system design;",
  "  securitySignal = relation to authn/authz/identity/data-protection/permissions.",
  "- Every non-low signal MUST have a one-line reason grounded in the patch.",
  "  If you cannot justify it from the patch, use 'low'.",
  "- NEVER claim production usage, ownership, or business impact. Put anything you",
  "  cannot know from the patch into 'questions' instead.",
  "- questions: what a human must answer to recover missing context",
  "  (was it used in production? your own design or maintenance of someone else's code?",
  "  customer-driven? part of a security boundary? replacing a manual process?).",
  "- confidence: your confidence in the summary.",
].join("\n");

/**
 * Builds the per-commit user prompt from a commit record and its patch.
 * @param record - The commit record (deterministic layer).
 * @param patch - The raw patch text.
 */
export function buildCommitUserPrompt(
  record: CommitRecord,
  patch: string,
): { prompt: string; truncated: boolean } {
  const truncated = patch.length > MAX_PATCH_CHARS;
  const body = truncated
    ? `${patch.slice(0, MAX_PATCH_CHARS)}\n\n[...patch truncated at ${MAX_PATCH_CHARS} chars...]`
    : patch;

  const det = record.deterministic;
  const prompt = [
    `Commit title: ${record.title}`,
    `Areas touched: ${det.areas.join(", ") || "(none)"}`,
    `Files added: ${det.changedFiles.added.join(", ") || "(none)"}`,
    `Files modified: ${det.changedFiles.modified.join(", ") || "(none)"}`,
    `Files deleted: ${det.changedFiles.deleted.join(", ") || "(none)"}`,
    `Files renamed: ${det.changedFiles.renamed.join(", ") || "(none)"}`,
    `Churn: +${det.linesAdded} / -${det.linesDeleted}`,
    "",
    "Patch:",
    "```diff",
    body,
    "```",
  ].join("\n");

  return { prompt, truncated };
}

// ───────────────────────────── per-session commit-group ─────────────────────────

// Stage 1 of the group flow: classify signals + context tiers (no prose summary).
export const GROUP_CLASSIFY_SYSTEM = [
  "You are an engineering historian analyzing ONE developer's WORK SESSION: commits authored",
  "close together in time, each with metadata, a per-commit summary, signals, and a context",
  "tier (HIGH / MEDIUM / LOW). Return a JSON object that CLASSIFIES the session.",
  "Do NOT write a prose summary here — that is a separate step.",
  "",
  "VOICE: first person ('I'); never 'the team', 'they', or 'we'.",
  "",
  "SIGNALS — rebuilt for the whole session:",
  "- technicalSignal / architectureSignal / securitySignal: 'low' | 'medium' | 'high'.",
  "- A session signal must be at least as high as its strongest member commit in that dimension.",
  "- Every non-low signal MUST have a one-line reason naming the specific high-signal change(s).",
  "",
  "CONTEXT TIERS — arrays of context bullets (NOT commit hashes, NOT IDs):",
  "- Group the work by MEANING: if several commits cover the same piece of work, MERGE them into",
  "  ONE bullet. If a commit is unrelated, ADD it as its own bullet.",
  "- hiContext: the SUBSTANTIAL design / implementation / security work (from HIGH-tier commits).",
  "- mediumContext: secondary, supporting work (from MEDIUM-tier commits).",
  "- lowContext: routine background — version bumps, CI, formatting, deps (from LOW-tier commits).",
  "- Each bullet is a concise phrase, e.g. 'Implemented RAD-SEC protocol support'. A tier may be empty.",
  "",
  "changeTypes: the change-type tags that apply to the session.",
  "questions: what I must answer later to recover missing context",
  "  (production? my own design or maintenance? customer-driven? a security boundary?).",
  "confidence: confidence in this classification.",
].join("\n");

// Stage 2 of the group flow: merge the commit summaries into one narrative,
// with detail proportional to each tier.
export const GROUP_COMPOSE_SYSTEM = [
  "You are an engineering historian. You are given a CLASSIFICATION of ONE developer's work",
  "session (signals + context tiers as bullets) and the per-commit summaries grouped by tier.",
  "Your task is to MERGE the commit summaries into ONE first-person narrative.",
  "Return JSON: { \"summary\": \"...\" }.",
  "",
  "VOICE: first person ('I'); never 'the team', 'they', or 'we'.",
  "",
  "HOW TO COMPOSE the summary — a multi-paragraph narrative whose detail follows the tiers:",
  "- HIGH-tier work: describe in FULL detail — a dedicated paragraph (or more) per distinct strand,",
  "  naming the real subsystems, modules, and areas. This is the core of the narrative.",
  "- MEDIUM-tier work: describe more briefly — a sentence or two each, woven into the narrative.",
  "- LOW-tier work: just MENTION it in one short closing sentence (e.g. 'plus routine CI, version,",
  "  and formatting upkeep'). No details.",
  "- This is a MERGE of the commit summaries, not a new invention: stay faithful to what they say.",
  "- Be concrete; never claim production use, ownership, or business impact.",
  "- A large, multi-theme session must be SEVERAL full paragraphs — never one generic sentence.",
].join("\n");

/**
 * Builds a compact, char-budgeted, tier-annotated view of the member commits.
 * @param members - Commit records in the group.
 */
function serializeMembers(members: CommitRecord[]): { text: string; truncated: boolean } {
  const tierTag = { hi: "HIGH", medium: "MEDIUM", low: "LOW" } as const;
  const blocks = members.map((c) => {
    const m = c.model;
    return [
      `### ${c.commitHash} [${tierTag[tierOf(c)]} context]`,
      `title: ${c.title}`,
      `areas: ${c.deterministic.areas.join(", ") || "(none)"}`,
      `churn: +${c.deterministic.linesAdded}/-${c.deterministic.linesDeleted}`,
      m
        ? `signals: tech=${m.technicalSignal} arch=${m.architectureSignal} sec=${m.securitySignal}`
        : "signals: (not summarized)",
      `summary: ${m?.summary ?? "(none)"}`,
    ].join("\n");
  });

  let text = blocks.join("\n\n");
  let truncated = false;
  if (text.length > MAX_MEMBERS_CHARS) {
    text = `${text.slice(0, MAX_MEMBERS_CHARS)}\n\n[...member list truncated...]`;
    truncated = true;
  }
  return { text, truncated };
}

/**
 * Builds the STAGE 1 (classify) user prompt for a group.
 * @param group - The group record with aggregated deterministic layer + tiers.
 * @param members - The member commit records.
 */
export function buildGroupClassifyPrompt(
  group: GroupRecord,
  members: CommitRecord[],
): { prompt: string; truncated: boolean } {
  const { text, truncated } = serializeMembers(members);
  const det = group.deterministic;
  const tiers = group.groups.tiers;

  const prompt = [
    `Work session of ${group.commitCount} commit(s) by a single developer.`,
    `Tier mix: ${tiers.hi.length} high · ${tiers.medium.length} medium · ${tiers.low.length} low.`,
    `Aggregated areas: ${det.areas.join(", ") || "(none)"}`,
    `Aggregated churn: +${det.linesAdded}/-${det.linesDeleted}`,
    `Files added: ${det.changedFiles.added.join(", ") || "(none)"}`,
    `Files modified: ${det.changedFiles.modified.join(", ") || "(none)"}`,
    `Files deleted: ${det.changedFiles.deleted.join(", ") || "(none)"}`,
    "",
    "Commit → tier (deterministic, reference for which commits feed which context):",
    JSON.stringify(tiers),
    "",
    "Member commits (draw hiContext bullets from HIGH-tier ones, lowContext from LOW-tier):",
    text,
  ].join("\n");

  return { prompt, truncated };
}

/** A view of the stage-1 classification needed to compose the summary. */
export interface GroupClassifyView {
  technicalSignal: string;
  architectureSignal: string;
  securitySignal: string;
  hiContext: string[];
  mediumContext: string[];
  lowContext: string[];
}

/** Gathers the per-commit summaries for members in a given tier. */
function summariesByTier(members: CommitRecord[], tier: "hi" | "medium" | "low"): string[] {
  return members
    .filter((c) => tierOf(c) === tier)
    .map((c) => `- ${c.title}: ${c.model?.summary ?? "(not summarized)"}`);
}

/**
 * Builds the STAGE 2 (compose) user prompt: the classified tiers plus the
 * member commit summaries grouped by tier, to be merged into one narrative.
 * @param group - The group record.
 * @param classify - The stage-1 classification result.
 * @param members - The member commit records.
 */
export function buildGroupComposePrompt(
  group: GroupRecord,
  classify: GroupClassifyView,
  members: CommitRecord[],
): { prompt: string; truncated: boolean } {
  const bullets = (items: string[]): string => items.map((b) => `- ${b}`).join("\n") || "(none)";
  const sums = (tier: "hi" | "medium" | "low"): string => summariesByTier(members, tier).join("\n") || "(none)";

  let prompt = [
    `Work session of ${group.commitCount} commit(s) by a single developer. Compose the summary now.`,
    `Session signals: tech=${classify.technicalSignal} arch=${classify.architectureSignal} sec=${classify.securitySignal}`,
    "",
    "HIGH-tier context (describe in FULL detail — a paragraph or more per strand):",
    bullets(classify.hiContext),
    "HIGH-tier commit summaries to merge:",
    sums("hi"),
    "",
    "MEDIUM-tier context (describe briefly):",
    bullets(classify.mediumContext),
    "MEDIUM-tier commit summaries to merge:",
    sums("medium"),
    "",
    "LOW-tier context (just mention in one short closing sentence):",
    bullets(classify.lowContext),
  ].join("\n");

  let truncated = false;
  if (prompt.length > MAX_MEMBERS_CHARS) {
    prompt = `${prompt.slice(0, MAX_MEMBERS_CHARS)}\n\n[...truncated...]`;
    truncated = true;
  }
  return { prompt, truncated };
}