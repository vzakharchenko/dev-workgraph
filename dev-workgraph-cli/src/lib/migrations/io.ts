// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { writeRecordJson } from "../record-io.js";
import { VERSION } from "../version.js";

/** Reads encoded schema version; legacy files without the field are `0`. */
export function readSchemaVersion(filePath: string): number {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { schemaVersion?: number };
  return raw.schemaVersion ?? 0;
}

export function readRecordJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

export function backupArtifactFile(filePath: string, fromVersion: number): void {
  const backupPath = `${filePath}.bak.${fromVersion}`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

export function writeMigratedRecord(filePath: string, record: object, dryRun: boolean): void {
  if (dryRun) return;
  writeRecordJson(filePath, record);
}

/** Bumps schemaVersion to current CLI build without changing payload. */
export function stampSchemaVersionOnly(filePath: string, dryRun: boolean): number {
  if (dryRun) return VERSION;
  const record = readRecordJson(filePath);
  record.schemaVersion = VERSION;
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return VERSION;
}

export function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => a.localeCompare(b));
}

export function listFinishQuestionFiles(finishDir: string): string[] {
  return listJsonFiles(finishDir).filter((f) => path.basename(f).includes(".question"));
}

export function listFinishArchiveFiles(finishDir: string): string[] {
  return listJsonFiles(finishDir).filter((f) => !path.basename(f).includes(".question"));
}
