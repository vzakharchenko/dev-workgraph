// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0
//
// All LLM-facing prompts live here so the exact wording is easy to find and tune.
// Two flows: per-commit `summarize` and per-session `commit-group`.

import { tierOf } from "./grouping.js";
import type { QuestionAnalyses } from "./model.js";
import type { CommitRecord, GroupRecord, ProjectContext, ReportRecord } from "./records.js";
import { MAX_HISTORY_ENTRIES } from "./report-provenance.js";

export { MAX_HISTORY_ENTRIES };

// ───────────────────────────── project context (from `init`) ─────────────────

/** Per-role guidance for what `questions` should probe (MVP §0). */
const ROLE_QUESTION_EMPHASIS: Record<string, string> = {
  "Principal Developer":
    "system-wide trade-offs, cross-team boundaries, long-term architectural consequences, org-scale production adoption",
  "Staff Developer":
    "design ownership across subsystems, platform direction, integration with adjacent systems",
  "Senior Developer":
    "feature/design ownership, customer or product driver, replacing manual processes, mentoring or review scope",
  "Junior Developer":
    "assigned vs self-directed work, learning context, scope of autonomy, who reviewed or unblocked",
};

/**
 * Renders the project-context grounding block to prepend to later prompts.
 * Returns "" when `init` has not run (so prompts behave as before).
 * @param ctx - The project context, or null.
 */
export function projectContextBlock(ctx: ProjectContext | null): string {
  if (!ctx) return "";
  const p = ctx.profile;
  const emphasis =
    ROLE_QUESTION_EMPHASIS[ctx.role] ?? "what Git cannot show — ownership, intent, production use";
  return [
    "PROJECT CONTEXT (grounding — interpret the work in light of this; NEVER let it inflate impact):",
    `- Developer role: ${ctx.role}`,
    `- Project: ${p.summary}`,
    `- Domains: ${p.domains.join(", ") || "(unknown)"}`,
    `- Apparent stack: ${p.apparentStack.join(", ") || "(unknown)"}`,
    `- Key themes: ${p.keyThemes.join(", ") || "(unknown)"}`,
    `- Background (prepared from the developer's story; may be incomplete): ${ctx.story.preparedContext}`,
    `- Frame questions for a ${ctx.role}: ${emphasis}. Avoid questions the background already answers.`,
  ].join("\n");
}

/**
 * Prepends a project-context block to a system prompt when present.
 * @param block - Output of {@link projectContextBlock}.
 * @param system - The base system prompt.
 */
export function withProjectContext(block: string, system: string): string {
  return block ? `${block}\n\n${system}` : system;
}

// ───────────────────────────── project init (`init`) ─────────────────────────

/** Max README characters sent to the profile session. */
const MAX_README_CHARS = 12000;

// Session 1: reframe the raw story for the developer's seniority.
export const STORY_PREPARE_SYSTEM = [
  "You help ONE developer prepare project context for later analysis of their Git history.",
  "First person ('I'); never 'the team', 'they', or 'we'. Return JSON { \"preparedContext\": \"...\" }.",
  "You are given the developer's ROLE and their raw, free-form PROJECT STORY.",
  "Reframe the SAME facts for what matters at that seniority (e.g. Principal → system boundaries and",
  "cross-cutting decisions; Junior → scope, learning, assigned vs self-directed). Do NOT invent facts",
  "or inflate impact — only reorganize and emphasize what the story already states. Keep it concise.",
].join("\n");

/**
 * Builds the story-prepare user prompt.
 * @param role - The developer's role.
 * @param rawStory - The raw free-form project story.
 */
export function buildStoryPreparePrompt(role: string, rawStory: string): string {
  return [`Developer role: ${role}`, "", "Raw project story:", rawStory || "(none provided)"].join(
    "\n",
  );
}

// Session 2: build a factual project profile from the prepared story + README.
export const PROJECT_PROFILE_SYSTEM = [
  "You build a factual PROFILE of a software project to ground later analysis of its Git history.",
  'Return JSON { "summary", "domains": [], "apparentStack": [], "keyThemes": [] }.',
  "You are given the developer's role, a prepared project context, and the README (if any).",
  "- summary: what the project appears to be about.",
  "- domains: the problem domains it operates in.",
  "- apparentStack: technologies evident from the README/story.",
  "- keyThemes: recurring themes or events the README and story support.",
  "This is interpretation, not proof — do NOT assert production usage, success, or business impact.",
].join("\n");

/**
 * Builds the project-profile user prompt.
 * @param role - The developer's role.
 * @param preparedContext - The prepared story context from session 1.
 * @param readme - README contents (may be empty).
 */
export function buildProjectProfilePrompt(
  role: string,
  preparedContext: string,
  readme: string,
): string {
  const body =
    readme.length > MAX_README_CHARS
      ? `${readme.slice(0, MAX_README_CHARS)}\n[...truncated...]`
      : readme;
  return [
    `Developer role: ${role}`,
    "",
    "Prepared project context:",
    preparedContext || "(none)",
    "",
    "README:",
    body || "(no README)",
  ].join("\n");
}

/** Max patch characters sent to the per-commit model; longer patches are truncated. */
const MAX_PATCH_CHARS = 12000;

/** Char budget for the serialized member commits in the group prompt. */
const MAX_MEMBERS_CHARS = 16000;

// Shared across every stage: routine upkeep is named, never detailed; substantive work wins.
const ROUTINE_RULE = [
  "ROUTINE MAINTENANCE — name it, do not detail it:",
  "- Dependency updates/bumps, version or release updates, lockfile and build-config tweaks,",
  "  formatting, and CI/build upkeep are ROUTINE. The specific version or dependency does NOT matter.",
  "- ROUTINE also includes: ADAPTING to a new version of a dependency or framework (e.g. supporting",
  "  a new major framework version, bumping package/module/SCM versions, build-config changes to compile against it),",
  "  and removing unused imports, fixing indentation, or reformatting — EVEN WHEN MANY FILES CHANGE.",
  "  A large diff of version bumps and mechanical edits is still routine.",
  "- SUBSTANTIVE = NEW behavior or features, a genuine refactor of real logic, real bug fixes, or",
  "  security-relevant changes. Volume of changed files does NOT make upkeep substantive.",
  "- If the work is ONLY routine, state that plainly as routine maintenance (no version numbers, no",
  "  per-bump list).",
  "- If there is substantive work as well, describe ONLY the substantive work and treat the routine",
  "  part as incidental. Never enumerate individual version or dependency changes.",
].join("\n");

// Human answers are used in the final stage as a correction layer, not merely appended context.
// This prevents final reports from keeping over-strong Git-based reconstructions after the
// developer clarifies that the work was a POC, prototype, investigation, partial implementation,
// rejected option, or unfinished production direction.
const ANSWER_CORRECTION_RULE = [
  "HUMAN ANSWERS ARE A CORRECTION LAYER:",
  "- Treat my answers as higher-priority context than the prepared Git-based history whenever they",
  "  clarify, narrow, or correct the reconstruction.",
  "- If the prepared history says or implies a stronger claim, but my answer describes the work as",
  "  a POC, prototype, investigation, evaluation, template, partial implementation, or future",
  "  direction, rewrite the claim to that narrower scope.",
  "- If my answer says a technology was evaluated, rejected, too expensive, not selected, or only",
  "  used as an example, do NOT describe it as the final architecture or production solution.",
  "- If my answer says ownership was not finalized, production adoption was not completed, or SLA/",
  "  compliance/operations were not formally defined, do NOT imply completed production ownership.",
  "- If my answer contradicts the prepared history, the answer wins. Rewrite the narrative instead",
  "  of appending the answer as a separate caveat.",
].join("\n");

// ───────────────────────────── per-commit summarize ─────────────────────────────

export const COMMIT_SUMMARY_SYSTEM = [
  "You are an engineering historian analyzing a single Git commit (metadata + patch)",
  "authored by ONE developer. Return a JSON object describing the change.",
  "SOURCE OF TRUTH — the PATCH, not the commit message:",
  "- Base every conclusion on what the DIFF actually does. The commit title/message is just the",
  "  author's note: unverified CONTEXT, often vague, stale, aspirational, or plain wrong.",
  "- Use the message only as a hint to interpret the diff (e.g. which problem it targets). NEVER",
  "  restate the message as fact, and never describe work the diff does not show.",
  "- If the message and the diff disagree, TRUST THE DIFF. If the message claims more than the diff",
  "  proves (e.g. 'rewrote auth' but the diff only renames a variable), describe the diff's real,",
  "  smaller scope and leave the discrepancy for 'questions'.",
  "Rules:",
  "- summary: describe WHAT the diff changed, in plain language. Describe the change itself,",
  "  NOT its importance, business impact, or whether it shipped to production.",
  "- technologies: the concrete languages, frameworks, libraries, tools, services, and",
  "  protocols the patch ACTUALLY uses — judged from file extensions, imports, config,",
  "  package/dependency names, and API calls in the diff. Use canonical names (e.g.",
  "  'TypeScript', 'React', 'PostgreSQL', 'Docker', 'GitHub Actions'). Only list what the",
  "  patch shows; do NOT guess the broader stack. Empty array if nothing identifiable.",
  "- Never use 'the team', 'they', or imply multiple authors. This is one person's commit.",
  "- Signals are 'low' | 'medium' | 'high' only. technicalSignal = technical depth;",
  "  architectureSignal = effect on structure/boundaries/modules/system design;",
  "  securitySignal = relation to authn/authz/identity/data-protection/permissions.",
  "- Every non-low signal MUST have a one-line reason grounded in the patch.",
  "  If you cannot justify it from the patch, use 'low'.",
  "- NEVER claim production usage, ownership, or business impact. Put anything you",
  "  cannot know from the patch into 'questionsAnalysis' instead.",
  "- questionsAnalysis: the REASONED form of the missing context. Produce 1–4 entries",
  "  (an empty array only for a purely routine commit). Each entry is an object",
  "  { observation, missingPiece, question }:",
  "    • observation: what the DIFF actually shows — grounded in the patch, not the message",
  "      (e.g. 'The diff adds Docker deploy scripts plus .gitignore and package changes,",
  "      which looks like local-environment setup rather than a production deploy.').",
  "    • missingPiece: the human context the patch cannot establish — ownership, intent,",
  "      whether it shipped, who drove it (e.g. 'Unclear whether this container ever reached",
  "      real servers or stayed developer tooling.').",
  "    • question: ONE precise question to ask the developer to recover that missing piece.",
  "      Target what Git cannot know: production use? your own design or maintenance of",
  "      someone else's code? customer-driven? a security boundary? replacing a manual process?",
  "- confidence: your confidence in the summary.",
  "",
  ROUTINE_RULE,
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
    `Commit message (author's note — CONTEXT ONLY, may be inaccurate; trust the patch): ${record.title}`,
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
  "- Each bullet is a concise phrase, e.g. 'Implemented the background job scheduler'. A tier may be empty.",
  "",
  "changeTypes: the change-type tags that apply to the session.",
  "",
  "questionsAnalyses — the AGGREGATED reasoned questions for the whole session. Each member",
  "commit carried its own { observation, missingPiece, question }. MERGE them by open thread:",
  "- Each entry is an object whose three fields are ARRAYS:",
  "    { observation: [...], missingPiece: [...], question: [...] }.",
  "- Group commits that probe the SAME open thread into ONE entry: collect their observations",
  "  into `observation`, their missing pieces into `missingPiece`, their questions into `question`.",
  "- Unrelated threads go in SEPARATE entries. Drop pure-duplicate strings. Routine-only",
  "  upkeep does not produce an entry.",
  "confidence: confidence in this classification.",
  "",
  ROUTINE_RULE,
  "- Keep routine upkeep to a single generic lowContext bullet; never put it in hiContext/mediumContext.",
].join("\n");

// Stage 2 of the group flow: merge the commit summaries into one narrative,
// with detail proportional to each tier.
export const GROUP_COMPOSE_SYSTEM = [
  "You are an engineering historian. You are given a CLASSIFICATION of ONE developer's work",
  "session (signals + context tiers as bullets) and the per-commit summaries grouped by tier.",
  "Your task is to MERGE the commit summaries into ONE first-person HISTORY — a fuller account,",
  'not a terse summary. Return JSON: { "history": "..." }.',
  "",
  "VOICE: first person ('I'); never 'the team', 'they', or 'we'.",
  "",
  "Write ONE flowing first-person narrative. Do NOT label or head sections by tier — never output",
  "'HIGH-tier context:', 'MEDIUM-tier:', 'LOW-tier:' or similar. The tiers control how much detail",
  "each piece of work gets, NOT the structure of the text.",
  "",
  "HOW TO COMPOSE the history — a multi-paragraph narrative whose detail follows the tiers:",
  "- HIGH-tier work: MANDATORY. Cover EVERY hiContext item in FULL detail — a dedicated paragraph",
  "  (or more) per distinct strand, naming the real subsystems, modules, and areas. This is the core.",
  "- MEDIUM-tier work: you MUST say something about it — cover the medium-tier work briefly, woven",
  "  into the narrative. Do not drop it entirely; it need not be exhaustive item-by-item.",
  "- LOW-tier work: OPTIONAL — at most a brief mention (e.g. 'plus routine version and formatting",
  "  upkeep'); it may be omitted.",
  "- This is a MERGE of the commit summaries, not a new invention: stay faithful to what they say.",
  "- Be concrete; never claim production use, ownership, or business impact.",
  "- A large, multi-theme session must be SEVERAL full paragraphs — never one generic sentence.",
  "",
  ROUTINE_RULE,
  "- If the whole session is only routine, the history is one short sentence stating that.",
].join("\n");

/**
 * Builds a compact, char-budgeted, tier-annotated view of the member commits.
 * @param members - Commit records in the group.
 */
function serializeMembers(members: CommitRecord[]): { text: string; truncated: boolean } {
  const tierTag = { hi: "HIGH", medium: "MEDIUM", low: "LOW" } as const;
  const blocks = members.map((c) => {
    const m = c.model;
    const analysis = (m?.questionsAnalysis ?? [])
      .map((q) => `  - obs: ${q.observation} | missing: ${q.missingPiece} | q: ${q.question}`)
      .join("\n");
    return [
      `### ${c.commitHash} [${tierTag[tierOf(c)]} context]`,
      `title: ${c.title}`,
      `areas: ${c.deterministic.areas.join(", ") || "(none)"}`,
      `churn: +${c.deterministic.linesAdded}/-${c.deterministic.linesDeleted}`,
      m
        ? `signals: tech=${m.technicalSignal} arch=${m.architectureSignal} sec=${m.securitySignal}`
        : "signals: (not summarized)",
      `summary: ${m?.summary ?? "(none)"}`,
      `questionsAnalysis:\n${analysis || "  (none)"}`,
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
  const sums = (tier: "hi" | "medium" | "low"): string =>
    summariesByTier(members, tier).join("\n") || "(none)";

  let prompt = [
    `Work session of ${group.commitCount} commit(s) by a single developer. Compose the history now.`,
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

// ───────────────────────────── cumulative report (`report`) ─────────────────────

/** Max bullets kept per context tier (keeps the merge prompt bounded). */
export const MAX_CONTEXT_BULLETS = 12;

// In the report, routine upkeep collapses to ONE generic item (builds on the shared ROUTINE_RULE).
const ROUTINE_MAINTENANCE_RULE = [
  ROUTINE_RULE,
  "- In the report, represent ALL routine work as ONE generic low-tier item, e.g. 'Ongoing",
  "  maintenance: dependency updates, version releases, build/CI upkeep.' Never a per-release entry.",
].join("\n");

const bulletList = (items: string[]): string => items.map((b) => `- ${b}`).join("\n") || "(none)";

/** Renders aggregated questionsAnalyses (group/report) for a merge prompt. */
const analysesBlock = (entries: QuestionAnalyses[]): string =>
  entries
    .map((e, i) => {
      const observations = e.observation.length
        ? e.observation.map((o, j) => `       ${j + 1}. ${o}`).join("\n")
        : "       (none)";
      const missing = e.missingPiece.length
        ? e.missingPiece.map((m, j) => `       ${j + 1}. ${m}`).join("\n")
        : "       (none)";
      const questions = e.question.length
        ? e.question.map((q, j) => `       ${j + 1}. ${q}`).join("\n")
        : "       (none)";
      return [
        `  thread ${i + 1}:`,
        "     observations:",
        observations,
        "     missing pieces:",
        missing,
        "     questions:",
        questions,
      ].join("\n");
    })
    .join("\n\n") || "(none)";

// Merge the accumulated report's model layer with the next group's model layer.
export const REPORT_MERGE_SYSTEM = [
  "You are merging an ACCUMULATED report of ONE developer's work with the NEXT work session,",
  "to produce the combined classification. First person ('I'); never 'the team', 'they', or 'we'.",
  "You are given the report's current model layer and the new group's model layer. Produce:",
  "- changeTypes: union of both; merge near-duplicate tags.",
  "- signalReasons.{technical,architecture,security}: ARRAYS merging both sides' reasons;",
  "  collapse duplicate or near-duplicate reasons into one entry.",
  "- questionsAnalyses: REBUILD the aggregated reasoned questions for the combined work from BOTH",
  "  sides' questionsAnalyses. Each entry: { observation: [...], missingPiece: [...], question: [...] }.",
  "  THREAD IDENTITY — decide whether two entries are the SAME open thread primarily from whether they",
  "  share the same missingPiece (human context Git cannot show), supported by overlapping observation",
  "  (what the diffs show). Do NOT merge solely because question wording is similar; do NOT split solely",
  "  because question wording differs if the missing piece is the same.",
  "  MERGE WITHIN A THREAD — union observations and missingPieces (drop duplicate/near-duplicate strings).",
  "  In question: keep ONE best question per thread — read each candidate's meaning, pick or rewrite the",
  "  sharpest single question that recovers the merged missing piece. Do NOT accumulate multiple question",
  "  strings for the same thread unless they ask genuinely different things that cannot be one question.",
  "  VALUE — rank threads by what still matters most for the developer's role (see PROJECT CONTEXT):",
  "  production use, ownership vs maintenance, customer/product driver, security boundary, and major",
  "  design decisions outrank minor clarifications, housekeeping, and routine upkeep. Questions tied to",
  "  hi-tier / high-signal work outrank those tied only to low-tier upkeep.",
  "  DROP threads already answered, pure duplicates, and anything about routine upkeep (never an entry",
  "  for routine-only work).",
  `- BOUND to at most ${MAX_CONTEXT_BULLETS} entries. When over the limit, merge near-duplicate threads`,
  "  and DROP the least valuable; KEEP the most important threads first in the output list.",
  "- confidence: re-assess for the combined work (low | medium | high).",
  "- hiContext / mediumContext / lowContext: MERGE the bullets from both sides; collapse duplicate",
  "  and near-duplicate bullets. Then RE-RANK importance DOWNWARD ONLY: a hi bullet that is minor",
  "  next to the other hi/medium bullets may be merged into another bullet or demoted one tier.",
  "  NEVER promote a bullet to a higher tier. This keeps the report from inflating as it grows.",
  `- BOUND each tier to at most ${MAX_CONTEXT_BULLETS} bullets. When over the limit, merge near-duplicates`,
  "  and DROP the least important; KEEP the bullets most relevant to the developer's role (see PROJECT",
  "  CONTEXT). List the most important bullets first.",
  "- No overclaiming: production use, ownership, and impact belong in questions, not statements.",
  "",
  ROUTINE_MAINTENANCE_RULE,
].join("\n");

// Step 1 gate: is this whole work session ONLY routine maintenance?
export const ROUTINE_CHECK_SYSTEM = [
  "You classify whether a developer's WORK SESSION is ONLY routine project maintenance.",
  'Return JSON { "routine": true|false, "reason": "..." }.',
  "ROUTINE = dependency bumps, version/release updates, lockfile/build-config tweaks, formatting,",
  "  CI/build upkeep, and similar — work where the specific version or dependency does not matter.",
  "SUBSTANTIVE = any design, implementation, refactor of real logic, new feature, bug fix, or",
  "  security-relevant change.",
  "Set routine=true ONLY if the session is entirely routine with nothing substantive.",
  "When in doubt, set routine=false — better to analyze than to drop real work.",
].join("\n");

/**
 * Builds the routine-gate prompt from the group's own model + evidence.
 * @param group - The group record being folded.
 */
export function buildRoutineCheckPrompt(group: GroupRecord): string {
  const g = group.model;
  return [
    `Work session of ${group.commitCount} commit(s).`,
    `changeTypes: ${(g?.changeTypes ?? []).join(", ") || "(none)"}`,
    `signals: tech=${g?.technicalSignal} arch=${g?.architectureSignal} sec=${g?.securitySignal}`,
    `areas: ${group.deterministic.areas.join(", ") || "(none)"}`,
    "",
    "Session history:",
    g?.history ?? "(none)",
  ].join("\n");
}

// How the tiers control depth of detail in the history. Shared by both sessions.
const HISTORY_TIER_RULES = [
  "This is a HISTORY, not a terse summary: describe FULLY what I did. The tiers control DEPTH:",
  "- HIGH-tier context: MANDATORY. Cover EVERY item in DETAIL — name the real subsystems, modules,",
  "  and what changed. This is the core of the history.",
  "- MEDIUM-tier context: you MUST say something about it — cover it briefly (do not drop it",
  "  entirely), but it need not be exhaustive item-by-item.",
  "- LOW-tier context: OPTIONAL — at most a brief mention, and may be omitted entirely.",
].join("\n");

/** Provenance is code-side only — history LLM sessions return text, never sourceGroups. */
const HISTORY_NO_PROVENANCE = [
  "Return TEXT ONLY. Do NOT include sourceGroups, sourceGroup, group file names, or any provenance",
  "metadata — the CLI tracks which group files fed each entry deterministically.",
].join("\n");

// Compact the oldest part of the running history to keep the report bounded.
export const REPORT_COMPACT_SYSTEM = [
  "You compact the OLDEST part of a developer's running work HISTORY to keep the report bounded.",
  "First person ('I'); never 'the team', 'they', or 'we'. Return JSON { \"history\": [\"...\"] }.",
  HISTORY_NO_PROVENANCE,
  "You are given several older history entries. Condense them into ONE (at most two) entries that",
  "PRESERVE what matters most for the developer's role (see PROJECT CONTEXT) in detail, and compress",
  "routine or less-relevant work into brief mentions. Stay FAITHFUL — do not invent facts.",
  "Plain first-person prose — no tier headers or labels ('HIGH-tier:', etc.).",
  "",
  ROUTINE_MAINTENANCE_RULE,
].join("\n");

/**
 * Builds the compaction prompt from the overflow (oldest) history entry texts.
 * @param entries - The oldest history entry texts to condense.
 */
export function buildReportCompactPrompt(entries: string[]): string {
  return [
    "Older history entries to condense (oldest first):",
    entries.map((s, i) => `${i + 1}. ${s}`).join("\n\n") || "(none)",
  ].join("\n");
}

/**
 * Builds the report-merge user prompt from the current report and the next group.
 * @param report - The accumulated report.
 * @param group - The next group to fold in.
 */
export function buildReportMergePrompt(report: ReportRecord, group: GroupRecord): string {
  const r = report.model;
  const g = group.model;
  return [
    "ACCUMULATED report model so far:",
    `- changeTypes: ${r.changeTypes.join(", ") || "(none)"}`,
    `- signalReasons.technical: ${bulletList(r.signalReasons.technical)}`,
    `- signalReasons.architecture: ${bulletList(r.signalReasons.architecture)}`,
    `- signalReasons.security: ${bulletList(r.signalReasons.security)}`,
    `- questionsAnalyses:\n${analysesBlock(r.questionsAnalyses)}`,
    `- hiContext:\n${bulletList(r.hiContext)}`,
    `- mediumContext:\n${bulletList(r.mediumContext)}`,
    `- lowContext:\n${bulletList(r.lowContext)}`,
    "",
    "NEXT group model to fold in:",
    `- changeTypes: ${(g?.changeTypes ?? []).join(", ") || "(none)"}`,
    `- signalReasons.technical: ${g?.signalReasons.technical ?? "(none)"}`,
    `- signalReasons.architecture: ${g?.signalReasons.architecture ?? "(none)"}`,
    `- signalReasons.security: ${g?.signalReasons.security ?? "(none)"}`,
    `- questionsAnalyses:\n${analysesBlock(g?.questionsAnalyses ?? [])}`,
    `- hiContext:\n${bulletList(g?.hiContext ?? [])}`,
    `- mediumContext:\n${bulletList(g?.mediumContext ?? [])}`,
    `- lowContext:\n${bulletList(g?.lowContext ?? [])}`,
  ].join("\n");
}

/** Renders the three context tiers for a prompt. */
function contextTiersBlock(contexts: {
  hiContext: string[];
  mediumContext: string[];
  lowContext: string[];
}): string {
  return [
    "Current context tiers:",
    "HIGH:",
    bulletList(contexts.hiContext),
    "MEDIUM:",
    bulletList(contexts.mediumContext),
    "LOW:",
    bulletList(contexts.lowContext),
  ].join("\n");
}

// Decide whether the new session adds anything, and if so write only the new part.
export const REPORT_NEW_HISTORY_SYSTEM = [
  "You decide whether a NEW work session adds anything not already captured in the cumulative",
  "report's HISTORY. First person ('I'); never 'the team', 'they', or 'we'.",
  'Return JSON { "needed": bool, "text": "..." } — text only, no sourceGroups.',
  HISTORY_NO_PROVENANCE,
  HISTORY_TIER_RULES,
  "You are given the report's CURRENT history entry texts, the context tiers, and the",
  "NEW session's history. If EVERYTHING in the new session is already stated in the report history,",
  'set needed=false and text="". Otherwise set needed=true and write a history entry capturing',
  "ONLY what the new session adds, with depth matching the tiers. Stay faithful.",
  "Plain first-person prose — no tier headers or labels ('HIGH-tier:', etc.).",
  "",
  ROUTINE_MAINTENANCE_RULE,
  "- If the new session is ONLY routine maintenance and the history already has a maintenance",
  "  mention, set needed=false (do not add another). Add an entry only for substantive new work.",
].join("\n");

/**
 * Builds the prompt to decide on / create the new session's history entry.
 * @param history - The report's current history entry texts (provenance is not passed in).
 * @param contexts - The report's current context tiers.
 * @param newGroupHistory - The new group's own history.
 */
export function buildReportNewHistoryPrompt(
  history: string[],
  contexts: { hiContext: string[]; mediumContext: string[]; lowContext: string[] },
  newGroupHistory: string,
): string {
  return [
    contextTiersBlock(contexts),
    "",
    "Existing report history:",
    history.map((s, i) => `${i + 1}. ${s}`).join("\n\n") || "(none)",
    "",
    "NEW session history:",
    newGroupHistory,
  ].join("\n");
}
// ───────────────────────────── prepared narrative (`prepare`) ────────────────────

// Tech-clean: dedupe and collapse the accumulated technology list.
export const PREPARE_TECH_SYSTEM = [
  "You clean up a list of technologies, languages, frameworks, libraries, and tools that was",
  'accumulated across many commits. Return JSON { "technologies": ["..."] }.',
  "Rules:",
  "- Remove exact duplicates and near-duplicates (different casing/spelling/aliases →",
  "  one canonical name, e.g. 'Postgres' and 'PostgreSQL' → 'PostgreSQL').",
  "- COLLAPSE class hierarchies: when one entry is a more specific/'higher' form of another,",
  "  keep ONLY the more specific one. E.g. JavaScript ⊂ TypeScript → keep 'TypeScript', drop",
  "  'JavaScript'. Same for a base tool vs its concrete framework when one clearly subsumes the",
  "  other in this project (judge from the list as a whole).",
  "- Keep genuinely distinct technologies separate; do NOT over-merge unrelated items.",
  "- Use canonical, human-readable names. Preserve only what was in the input — invent nothing.",
  "- Return AT MOST 5 — the most SIGNIFICANT and prevalent technologies for this project",
  "  (the core languages and primary frameworks/platforms the work centres on). DROP minor,",
  "  incidental, or one-off tooling. Order from most to least significant.",
].join("\n");

/**
 * Builds the prepare tech-clean user prompt.
 * @param technologies - The report's accumulated (unioned) technology list.
 */
export function buildPrepareTechPrompt(technologies: string[]): string {
  return [
    "Accumulated technologies to clean and collapse:",
    bulletList(technologies) || "(none)",
  ].join("\n");
}

// Step 2: distill all report history entries into one role-aligned narrative.
export const PREPARE_HISTORY_SYSTEM = [
  "You distill a developer's full work HISTORY into ONE coherent first-person narrative for review.",
  "First person ('I'); never 'the team', 'they', or 'we'. Return JSON { \"history\": \"...\" }.",
  "You are given the role + project context, the report's signals/changeTypes (for grounding only),",
  "and the report's history entries. Rewrite them into a SINGLE flowing narrative that:",
  "- prioritizes what matters for the developer's role;",
  "- aligns with the project story and profile (no contradictions);",
  "- de-emphasizes routine upkeep (already collapsed) to a brief mention;",
  "- never overclaims production usage, ownership, or impact.",
  "Write flowing prose — no tier headers/labels, no bullet list of versions.",
].join("\n");

/**
 * Builds the prepare step-2 (compose history) user prompt.
 * @param rawHistory - The report history entries joined one per line.
 * @param signals - The report's three signal levels (for grounding).
 * @param changeTypes - The report's change types (for grounding).
 */
export function buildPrepareHistoryPrompt(
  rawHistory: string,
  signals: { technical: string; architecture: string; security: string },
  changeTypes: string[],
): string {
  return [
    `Report signals: tech=${signals.technical} arch=${signals.architecture} sec=${signals.security}`,
    `changeTypes: ${changeTypes.join(", ") || "(none)"}`,
    "",
    "Report history entries to merge into one narrative:",
    rawHistory || "(none)",
  ].join("\n");
}

// Step 4: collapse the report's signal-reason arrays into exactly four reasons.
export const PREPARE_REASONS_SYSTEM = [
  "You produce EXACTLY FOUR reason statements explaining why this body of work matters, reframed",
  "for the developer's role and the unified narrative. First person ('I') is fine.",
  'Return JSON { "signalReasons": ["...", "...", "...", "..."] } — a FLAT array of four strings.',
  "You are given the report's technical/architecture/security reason arrays and the composed history.",
  "Merge near-duplicates, DROP minor upkeep reasons, and keep the four most important. Never overclaim.",
].join("\n");

/**
 * Builds the prepare step-4 (collapse reasons) user prompt.
 * @param reasons - The report's signalReasons arrays.
 * @param history - The composed history from step 2.
 */
export function buildPrepareReasonsPrompt(
  reasons: { technical: string[]; architecture: string[]; security: string[] },
  history: string,
): string {
  return [
    "Composed history:",
    history || "(none)",
    "",
    "Report signal reasons:",
    `technical:\n${bulletList(reasons.technical)}`,
    `architecture:\n${bulletList(reasons.architecture)}`,
    `security:\n${bulletList(reasons.security)}`,
  ].join("\n");
}

// Step 5: reframe role-aware questionsAnalyses + re-assess confidence.
export const PREPARE_QUESTIONS_SYSTEM = [
  "You produce up to FOUR role-aware question analyses that recover the missing human context Git",
  "cannot show, plus a confidence. First person ('I'). Return JSON",
  '{ "questionsAnalyses": [{ "observation": ["..."], "missingPiece": ["..."], "question": ["..."] }],',
  '  "confidence": "low|medium|high" }.',
  "Given the composed history, the four signal reasons, the report's existing questionsAnalyses,",
  "any prior human Q&A from an earlier finish round, and the role + project context: write analyses",
  "targeting what still cannot be known (production use, ownership vs maintenance, customer/product",
  "driver, security boundary), framed for the role — especially gaps opened by NEW work in the",
  "history. Each entry is one open thread; usually one question string per entry. Do NOT repeat",
  "questions already answered in prior Q&A (same missing piece or paraphrase). Drop duplicates and",
  "facts already in the project context. confidence = your confidence in this narrative.",
].join("\n");

/**
 * Builds the prepare step-5 (reframe questions) user prompt.
 * @param history - The composed history from step 2.
 * @param reasons - The four collapsed reasons from step 4.
 * @param reportAnalyses - The report's existing questionsAnalyses.
 * @param priorQa - Q&A from the latest finish archive, when extending after new commits.
 */
export function buildPrepareQuestionsPrompt(
  history: string,
  reasons: string[],
  reportAnalyses: QuestionAnalyses[],
  priorQa: { question: string; answer: string }[] = [],
): string {
  const blocks = [
    "Composed history:",
    history || "(none)",
    "",
    "Signal reasons (4):",
    bulletList(reasons),
    "",
    "The report's existing questionsAnalyses:",
    analysesBlock(reportAnalyses),
  ];
  if (priorQa.length > 0) {
    blocks.push(
      "",
      "Prior human Q&A from the latest finish (do NOT repeat these threads):",
      priorQa.map((p) => `Q: ${p.question}\nA: ${p.answer || "(no answer)"}`).join("\n\n") ||
        "(none)",
    );
  }
  return blocks.join("\n");
}

// ───────────────────────────── final deliverable (`final`) ───────────────────────

// One session: turn the prepared history + human answers into a four-bullet Role Narrative.
export const ROLE_NARRATIVE_SYSTEM = [
  "You write a developer's ROLE NARRATIVE: EXACTLY FOUR impact bullet points, framed for their role.",
  "First person ('I'); never 'the team', 'they', or 'we'. Return JSON { \"narrative\": [\"...\" x4] }.",
  "You are given the prepared history, the project context (role + story + profile), the four",
  "collapsed signal reasons, and the human's four question-answer pairs.",
  "The history was already corrected against my answers; keep that narrower scope — if my answers",
  "describe a POC/prototype/evaluation or unfinished work, do not re-inflate it into a stronger claim.",
  "Each bullet describes what I did and WHERE, as the selected role, grounded in the history, the",
  "reasons, and MY OWN answers. Rules:",
  "- Never invent production usage, customer impact, org-wide adoption, SLA compliance, regulatory",
  "  compliance, completed migration, or production operations ownership unless I explicitly stated it",
  "  in an answer.",
  "- If this was a POC, prototype, investigation, or architecture evaluation, say that directly.",
  "- Prefer 'prototyped', 'evaluated', 'validated', 'implemented a template', 'created reusable",
  "  automation', or 'defined a migration direction' over 'transformed', 'replaced', or 'migrated'",
  "  unless the answers confirm a completed production migration.",
  "- Frame emphasis to the role's seniority (see PROJECT CONTEXT).",
  "TONE — technical and claim-safe, NOT marketing:",
  "- Write like an engineer describing the work to another engineer: concrete and specific — name",
  "  the actual components, protocols, mechanisms, and design decisions (e.g. 'implemented the",
  "  request retry/backoff logic in the HTTP client', not 'delivered a robust networking solution').",
  "- BAN marketing/hype words: spearheaded, revolutionized, robust, seamless, cutting-edge,",
  "  world-class, leveraged, synergy, game-changing, best-in-class, drove, championed, owned (as a",
  "  boast). Prefer plain verbs: implemented, added, refactored, designed, fixed, migrated,",
  "  evaluated, prototyped, validated.",
  "- No numeric scores, no superlatives, no adjectives that inflate impact.",
  "- State scope honestly (what changed, where); let the technical specifics carry the weight.",
].join("\n");

/**
 * Builds the Role Narrative prompt.
 * @param history - The prepared unified history.
 * @param reasons - The four collapsed signal reasons.
 * @param qa - The human's question-answer pairs.
 * @param recalledContext - Optional `deepen` input: non-code context the developer recalled
 *   this round (team, decisions, constraints, handoffs — not in Git). Shapes narrative
 *   refinement; not proof of production impact unless stated in answers or this text.
 *   Omitted for initial `final`.
 */
export function buildRoleNarrativePrompt(
  history: string,
  reasons: string[],
  qa: { question: string; answer: string }[],
  recalledContext?: string,
): string {
  const blocks = ["Prepared history:", history || "(none)"];
  if (recalledContext?.trim()) {
    blocks.push("", "Recalled context from this deepen round (non-code):", recalledContext.trim());
  }
  blocks.push(
    "",
    "Signal reasons:",
    bulletList(reasons),
    "",
    "My answers to the open questions:",
    qa.map((p) => `Q: ${p.question}\nA: ${p.answer || "(no answer)"}`).join("\n\n") || "(none)",
  );
  return blocks.join("\n");
}

// `final` step: refine the prepared history into the "Your IMPACT" prose, now that
// the human has answered the open questions. Same prose form as the prepared
// history, but the answers fill in the ownership/intent/impact Git could not show.
export const IMPACT_NARRATIVE_SYSTEM = [
  "You refine a developer's work HISTORY into ONE coherent first-person narrative, now that the",
  "human has answered the open questions. First person ('I'); never 'the team', 'they', or 'we'.",
  'Return JSON { "history": "..." }.',
  "You are given the prepared history (reconstructed from Git evidence) and the human's",
  "question-answer pairs.",
  "",
  ANSWER_CORRECTION_RULE,
  "",
  "Rewrite the narrative so it reflects the confirmed ownership, intent, scope, and constraints.",
  "Do NOT merely append the answers at the end. Apply them throughout the history.",
  "",
  "CLAIM SAFETY:",
  "- If the prepared history implies a completed production migration but my answers describe a POC,",
  "  prototype, investigation, evaluation, template, partial implementation, or migration direction,",
  "  rewrite it as that narrower scope.",
  "- If the prepared history says a technology was the final solution but my answers say it was only",
  "  evaluated, rejected, too expensive, or not selected, rewrite it accordingly.",
  "- If the prepared history implies production monitoring, compliance, tenant guarantees, SLAs, or",
  "  operational ownership, but my answers do not confirm them, soften the claim.",
  "- Never say 'guaranteed HIPAA compliance', 'completed migration', 'production-ready', 'replaced",
  "  the monolith', or 'owned production operations' unless I explicitly stated that.",
  "",
  "SAFE LANGUAGE EXAMPLES (the pattern, not the domain — adapt to the actual work):",
  "- 'prototyped a target architecture' instead of 're-architected the system'",
  "- 'validated a migration direction' instead of 'migrated the platform'",
  "- 'evaluated option A but chose option B as more practical due to cost/constraints' instead of",
  "  'built the solution on A'",
  "- 'validated an isolation/security mechanism' instead of 'guaranteed compliance'",
  "- 'created deployment templates/automation for handoff' instead of 'owned production operations'",
  "",
  "Write flowing prose — no tier headers/labels, no bullet list of versions, no Q/A formatting.",
  "TONE — technical and claim-safe, NOT marketing:",
  "- Write like an engineer to another engineer: name the actual components, protocols, mechanisms.",
  "- BAN hype words: spearheaded, revolutionized, robust, seamless, cutting-edge, world-class,",
  "  leveraged, synergy, game-changing, best-in-class, drove, championed, owned (as a boast).",
  "  Prefer plain verbs: implemented, added, refactored, designed, fixed, migrated, evaluated,",
  "  prototyped, validated.",
  "- No numeric scores, no superlatives, no adjectives that inflate impact.",
].join("\n");

/**
 * Builds the `final` "Your IMPACT" refinement prompt.
 * @param history - The prepared unified history (reconstructed from Git).
 * @param qa - The human's question-answer pairs.
 * @param recalledContext - Optional `deepen` input: non-code context the developer recalled
 *   this round (team, decisions, constraints, handoffs — not in Git). Woven into IMPACT
 *   where relevant without overclaiming. Omitted for initial `final`.
 */
export function buildImpactNarrativePrompt(
  history: string,
  qa: { question: string; answer: string }[],
  recalledContext?: string,
): string {
  const blocks = ["Prepared history (reconstructed from Git evidence):", history || "(none)"];
  if (recalledContext?.trim()) {
    blocks.push(
      "",
      "Recalled context from this deepen round (non-code — weave in where relevant; do not overclaim):",
      recalledContext.trim(),
    );
  }
  blocks.push(
    "",
    "My answers to the open questions:",
    qa.map((p) => `Q: ${p.question}\nA: ${p.answer || "(no answer)"}`).join("\n\n") || "(none)",
  );
  return blocks.join("\n");
}

/**
 * Merges prepare baseline history with the prior final's refined history — input stack for `deepen`.
 */
export function combinePreparedAndPriorHistory(
  preparedHistory: string,
  priorFinalHistory: string,
): string {
  const prepared = preparedHistory.trim();
  const prior = priorFinalHistory.trim();
  const blocks: string[] = [];
  if (prepared) {
    blocks.push("Baseline from prepare:", prepared);
  }
  if (prior) {
    if (blocks.length > 0) blocks.push("");
    blocks.push("Refined after prior final:", prior);
  }
  return blocks.join("\n").trim() || "(none)";
}

/**
 * Builds the `deepen` IMPACT refinement prompt (prepare baseline + prior final history + all Q&A).
 * @param preparedHistory - Unified history from the prepared record (Git-side baseline).
 * @param priorFinalHistory - Refined history from the finish record being extended.
 * @param qa - Cumulative question-answer pairs (prior rounds + this deepen round).
 * @param recalledContext - Non-code context recalled this deepen round; shapes refinement,
 *   not proof of production impact unless the developer stated that explicitly.
 */
export function buildDeepenImpactNarrativePrompt(
  preparedHistory: string,
  priorFinalHistory: string,
  qa: { question: string; answer: string }[],
  recalledContext?: string,
): string {
  const blocks = [
    "History (prepare baseline, then prior final):",
    combinePreparedAndPriorHistory(preparedHistory, priorFinalHistory),
  ];
  if (recalledContext?.trim()) {
    blocks.push(
      "",
      "Recalled context from this deepen round (non-code — weave in where relevant; do not overclaim):",
      recalledContext.trim(),
    );
  }
  blocks.push(
    "",
    "My answers to the open questions:",
    qa.map((p) => `Q: ${p.question}\nA: ${p.answer || "(no answer)"}`).join("\n\n") || "(none)",
  );
  return blocks.join("\n");
}

// `deepen`: four follow-up questionsAnalyses that must not repeat a prior round.
export const DEEPEN_QUESTIONS_SYSTEM = [
  "You produce up to FOUR NEW role-aware follow-up question analyses that recover human context Git",
  "cannot show. First person framing for the developer ('I'). Return JSON",
  '{ "questionsAnalyses": [{ "observation": ["..."], "missingPiece": ["..."], "question": ["..."] }],',
  '  "confidence": "low|medium|high" }.',
  "You are given PROJECT CONTEXT (role + story + profile from project.json), newly recalled",
  "human context (non-code memories about the project), combined history (prepare baseline plus",
  "prior final refinement), the report's questionsAnalyses, signal reasons, and every question",
  "already asked with its answer.",
  "Use the recalled context to ask sharper questions about what it opens up — but do NOT treat",
  "it as proof of production impact unless the developer stated that explicitly.",
  "Write four questions about gaps STILL not covered after prior Q&A and the recalled context —",
  "do NOT repeat, rephrase, or narrow the same angle as any prior question.",
  "Target what remains unknown: production use, ownership vs maintenance, customer/product driver,",
  "security boundary, handoff, constraints, or outcomes not yet stated.",
  "Frame for the role in PROJECT CONTEXT. confidence = confidence in the narrative so far.",
].join("\n");

/**
 * Builds the `deepen` follow-up-questions user prompt.
 * @param preparedHistory - Unified history from the prepared record.
 * @param priorFinalHistory - Refined history from the latest finish archive.
 * @param reasons - Four collapsed signal reasons from the prepared record.
 * @param reportQuestions - Report-level questions (context only; must not be repeated).
 * @param priorQuestions - Prepared questions from the initial round (must not be repeated).
 * @param priorQa - All Q&A pairs from prior finish rounds.
 * @param recalledContext - Non-code context recalled this deepen round; used to shape sharper
 *   follow-up questions, not treated as proven fact or production impact by default.
 */
export function buildDeepenQuestionsPrompt(
  preparedHistory: string,
  priorFinalHistory: string,
  reasons: string[],
  reportQuestions: string[],
  priorQuestions: string[],
  priorQa: { question: string; answer: string }[],
  recalledContext: string,
): string {
  return [
    "Newly recalled context (non-code — use to shape questions, not as proven fact):",
    recalledContext.trim() || "(none provided)",
    "",
    "Combined history (prepare baseline, then prior final):",
    combinePreparedAndPriorHistory(preparedHistory, priorFinalHistory),
    "",
    "Signal reasons (4):",
    bulletList(reasons),
    "",
    "Report questions (for context — do not repeat):",
    bulletList(reportQuestions),
    "",
    "Prepared questions already asked (do not repeat):",
    bulletList(priorQuestions),
    "",
    "Prior Q&A (do not re-ask these angles):",
    priorQa.length > 0
      ? priorQa.map((p) => `Q: ${p.question}\nA: ${p.answer || "(no answer)"}`).join("\n\n")
      : "(none)",
  ].join("\n");
}
