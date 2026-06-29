// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import inquirer from "inquirer";
import { getPeriod, type Period, setPeriod } from "./config.js";

/** ISO calendar date, `YYYY-MM-DD`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A period label is a directory name: word chars, dot, dash — no separators. */
const LABEL = /^[A-Za-z0-9._-]+$/;

/** A resolved review window in author-timestamp epoch seconds, half-open `[from, to)`. */
export interface PeriodRange {
  /** Inclusive lower bound (epoch seconds). */
  from: number;
  /** Exclusive upper bound (epoch seconds). */
  to: number;
}

/**
 * Validates an ISO `YYYY-MM-DD` date string (real calendar date, not just shape).
 * @param value - The candidate date string.
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Reject rollovers like 2022-02-30 → 2022-03-02.
  return new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * Converts an ISO `YYYY-MM-DD` date to epoch seconds at UTC midnight.
 * @param value - A validated ISO date string.
 */
function isoToEpochSeconds(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);
}

/**
 * Validates a period label for use as a directory name.
 * @param id - The candidate label.
 * @throws When the label is empty, has unsafe characters, or is a dot entry.
 */
function validatePeriodLabel(id: string): void {
  if (!id || !LABEL.test(id) || id === "." || id === "..") {
    throw new Error(
      `Invalid period label "${id}". Use letters, digits, dot, dash, or underscore (e.g. "2022", "2022-H1").`,
    );
  }
}

/**
 * Resolves a defined period to an epoch-second range for filtering commits.
 * @param repoPath - Absolute repository path.
 * @param id - The period label.
 * @throws When the period is not defined or has invalid dates.
 */
export function resolvePeriodRange(repoPath: string, id: string): PeriodRange {
  const period = getPeriod(repoPath, id);
  if (!period) {
    throw new Error(
      `Period "${id}" is not defined for this repo. Define it first with \`dev-workgraph init:period --period ${id} --from <YYYY-MM-DD> --to <YYYY-MM-DD>\`.`,
    );
  }
  if (!isValidIsoDate(period.from) || !isValidIsoDate(period.to)) {
    throw new Error(`Period "${id}" has invalid dates (from=${period.from}, to=${period.to}).`);
  }
  const from = isoToEpochSeconds(period.from);
  const to = isoToEpochSeconds(period.to);
  if (to <= from) {
    throw new Error(`Period "${id}" must have to (${period.to}) after from (${period.from}).`);
  }
  return { from, to };
}

/** Inputs to {@link resolvePeriodDefinition}: any may come from a flag. */
export interface PeriodDefinitionInput {
  repoPath: string;
  id?: string;
  from?: string;
  to?: string;
}

/**
 * Resolves (and persists) a period definition for `init`/`run`. Reuses an
 * existing definition when `id` is already configured and no new `from`/`to` are
 * supplied; otherwise prompts for whatever is missing, validates, and saves.
 * @param input - Repo path plus any flag-provided id/from/to.
 * @returns The resolved label and its window.
 */
export async function resolvePeriodDefinition(
  input: PeriodDefinitionInput,
): Promise<{ id: string; period: Period }> {
  const { repoPath } = input;

  let id = input.id;
  if (!id) {
    const answer = await inquirer.prompt<{ id: string }>([
      {
        type: "input",
        name: "id",
        message: "Period label (e.g. 2022, 2022-H1):",
        validate: (v: string) => (LABEL.test(v.trim()) ? true : "Use letters/digits/.-_ only"),
      },
    ]);
    id = answer.id.trim();
  }
  validatePeriodLabel(id);

  const existing = getPeriod(repoPath, id);
  // Reuse a configured period verbatim unless the caller overrides a bound.
  if (existing && input.from === undefined && input.to === undefined) {
    return { id, period: existing };
  }

  const from = await resolveDate("Start date (from, inclusive)", input.from ?? existing?.from);
  const to = await resolveDate("End date (to, exclusive)", input.to ?? existing?.to);
  if (isoToEpochSeconds(to) <= isoToEpochSeconds(from)) {
    throw new Error(`Period "${id}": to (${to}) must be after from (${from}).`);
  }

  const period: Period = { from, to };
  setPeriod(repoPath, id, period);
  return { id, period };
}

/** Prompts for (or validates a flag-provided) ISO date. */
async function resolveDate(message: string, preset?: string): Promise<string> {
  if (preset !== undefined) {
    if (!isValidIsoDate(preset)) {
      throw new Error(`Invalid date "${preset}". Expected ISO YYYY-MM-DD.`);
    }
    return preset;
  }
  const { date } = await inquirer.prompt<{ date: string }>([
    {
      type: "input",
      name: "date",
      message: `${message} — YYYY-MM-DD:`,
      validate: (v: string) => (isValidIsoDate(v.trim()) ? true : "Expected ISO YYYY-MM-DD"),
    },
  ]);
  return date.trim();
}
