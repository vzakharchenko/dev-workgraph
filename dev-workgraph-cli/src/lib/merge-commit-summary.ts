// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import {
  enforceSignalReasons,
  type ModelLayer,
  maxSignal,
  mergeTechnologies,
  type Signal,
} from "./model.js";

type SignalDimension = "technical" | "architecture" | "security";

const SIGNAL_KEYS: Record<SignalDimension, keyof ModelLayer> = {
  technical: "technicalSignal",
  architecture: "architectureSignal",
  security: "securitySignal",
};

/**
 * Deterministically merges per-part commit summaries (part1 → partN, left to right).
 * @param parts - Model layers from `<hash>.partN.json`, in part order.
 */
export function mergePartSummaries(parts: ModelLayer[]): ModelLayer {
  if (parts.length === 0) {
    throw new Error("mergePartSummaries requires at least one part");
  }

  const merged: ModelLayer = {
    summary: parts
      .map((p) => p.summary.trim())
      .filter(Boolean)
      .join(". "),
    changeTypes: mergeChangeTypes(...parts.map((p) => p.changeTypes)),
    technologies: mergeTechnologies(...parts.map((p) => p.technologies)),
    technicalSignal: foldMaxSignal(parts, "technicalSignal"),
    architectureSignal: foldMaxSignal(parts, "architectureSignal"),
    securitySignal: foldMaxSignal(parts, "securitySignal"),
    signalReasons: {
      technical: mergeSignalReason(parts, "technical"),
      architecture: mergeSignalReason(parts, "architecture"),
      security: mergeSignalReason(parts, "security"),
    },
    questionsAnalysis: parts.flatMap((p) => p.questionsAnalysis),
    confidence: foldMaxSignal(parts, "confidence"),
  };

  return enforceSignalReasons(merged);
}

function foldMaxSignal(
  parts: ModelLayer[],
  key: "technicalSignal" | "architectureSignal" | "securitySignal" | "confidence",
): Signal {
  return parts.reduce((acc, part) => maxSignal(acc, part[key]), "low" as Signal);
}

function mergeChangeTypes(...lists: (string[] | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) continue;
      const key = value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()];
}

function appendReason(level: Signal, existing: string, reason: string): string {
  if (!existing) return reason;
  const sep = level === "high" ? ", " : ". ";
  return `${existing}${sep}${reason}`;
}

/**
 * Folds signal reasons left-to-right for one dimension.
 * Escalation resets accumulated text; same-level parts append with `. ` (medium/low)
 * or `, ` (high).
 */
export function mergeSignalReason(parts: ModelLayer[], dim: SignalDimension): string {
  const signalKey = SIGNAL_KEYS[dim];
  let level: Signal = "low";
  let text = "";

  for (const part of parts) {
    const partLevel = part[signalKey] as Signal;
    const reason = part.signalReasons[dim].trim();
    if (!reason) continue;

    const nextLevel = maxSignal(level, partLevel);

    if (nextLevel !== level) {
      level = nextLevel;
      text = partLevel === nextLevel ? reason : "";
    } else if (partLevel === level) {
      text = appendReason(level, text, reason);
    }
  }

  return text;
}

/**
 * Absolute path to a per-part commit summary (`<hash>.partN.json`).
 */
export function commitSummaryPartPath(
  summariesDir: string,
  timestamp: number,
  commitHash: string,
  part: number,
): string {
  return path.join(summariesDir, String(timestamp), `${commitHash}.part${part}.json`);
}

/**
 * Absolute path to the merged split-commit summary (`<hash>.merge.json`).
 */
export function commitMergedSummaryPath(
  summariesDir: string,
  timestamp: number,
  commitHash: string,
): string {
  return path.join(summariesDir, String(timestamp), `${commitHash}.merge.json`);
}
