// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import type { MigrationArtifactKind } from "./types.js";

const KIND_LABELS: Record<MigrationArtifactKind, string> = {
  group: "groups",
  report: "reports",
  prepared: "prepared",
  "finish-questions": "finish-questions",
  finish: "finish archives",
};

function migrationKindLabel(kind: MigrationArtifactKind): string {
  return KIND_LABELS[kind];
}

/** Encoded schemaVersion → semver string (e.g. 1000006 → 1.0.6). */
function formatSchemaVersion(version: number): string {
  if (version <= 0) return "legacy";
  const major = Math.floor(version / 1_000_000);
  const minor = Math.floor((version % 1_000_000) / 1_000);
  const patch = version % 1_000;
  return `${major}.${minor}.${patch}`;
}

/** Path relative to repo data root for concise logs. */
export function relArtifactPath(filePath: string, dataRoot: string): string {
  const rel = path.relative(dataRoot, filePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  return path.basename(filePath);
}

export function logMigrationPhase(title: string): void {
  console.log(`\n── ${title} ──`);
}

export function logStructuralKindHeader(kind: MigrationArtifactKind, fileCount: number): void {
  console.log(`[structural] ${migrationKindLabel(kind)} (${fileCount} file(s)) …`);
}

export function logStructuralFileChanged(
  filePath: string,
  dataRoot: string,
  fromVersion: number,
  toVersion: number,
  stepLabels: string[],
): void {
  const rel = relArtifactPath(filePath, dataRoot);
  const steps = stepLabels.length > 0 ? ` [${stepLabels.join(", ")}]` : "";
  console.log(
    `  ${rel}  ${formatSchemaVersion(fromVersion)} → ${formatSchemaVersion(toVersion)}${steps}`,
  );
}

export function logStructuralKindSummary(changed: number, fileCount: number): void {
  if (fileCount === 0) {
    console.log("  (none)");
    return;
  }
  if (changed === 0) {
    console.log("  (all up to date)");
  }
}

export function logLlmBackfillHeader(model: string, baseUrl: string): void {
  console.log(`[llm backfill] prepare/finish lineage (narrative slot) · ${model} @ ${baseUrl}`);
  console.log("  (commit/report slots are saved like run but unused in migrate today)");
}

export function logLlmBackfillFile(relPath: string): void {
  console.log(`\n[llm backfill] ${relPath}`);
}

export function logLlmBackfillSkip(reason: string): void {
  console.log(`  skip — ${reason}`);
}

export function logLlmSubstep(message: string, suffix = ""): void {
  process.stdout.write(`   ${message}${suffix}`);
}

export function logLlmSubstepDone(suffix: string): void {
  console.log(suffix);
}
