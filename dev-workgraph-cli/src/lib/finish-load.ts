// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type {
  FinishRecord,
  FinishSourceQuestions,
  PreparedRecord,
  ReportRecord,
} from "./records.js";

/** Question-file version label (`v1` = initial `final`, `v2+` = deepen / extension). */
export function finishQuestionVersionLabel(version: number): string {
  return version <= 1 ? "v1" : `v${version}`;
}

const QUESTION_FILE_NAME_RE = /^(\d+)\.question(?:\.v(\d+))?\.json$/;
const VERSIONED_FINISH_STEM_RE = /^(\d+)\.v(\d+)$/;
const PLAIN_FINISH_STEM_RE = /^(\d+)$/;

/** Parses `v1`, `v2`, … into a finish-chain version number. */
export function parseFinishQuestionVersionLabel(label: string): number {
  const match = /^v(\d+)$/.exec(label.trim());
  if (!match) throw new Error(`Invalid question version label: ${label}`);
  return Number(match[1]);
}

/** Normalizes legacy `*.question.json` file names into {@link FinishSourceQuestions}. */
export function normalizeSourceQuestions(
  value: FinishSourceQuestions | string | undefined,
): FinishSourceQuestions {
  if (!value) return {};
  if (typeof value === "string") {
    const match = QUESTION_FILE_NAME_RE.exec(value);
    if (!match) return {};
    const baseFinishId = Number(match[1]);
    const version = match[2] ? Number(match[2]) : 1;
    return { [baseFinishId]: [finishQuestionVersionLabel(version)] };
  }
  return value;
}

/** Appends a question round label for `baseFinishId` (deduped, order preserved). */
export function extendSourceQuestions(
  prior: FinishSourceQuestions | string | undefined,
  baseFinishId: number,
  version: number,
): FinishSourceQuestions {
  const label = finishQuestionVersionLabel(version);
  const normalized = normalizeSourceQuestions(prior);
  const existing = normalized[baseFinishId] ?? [];
  if (existing.includes(label)) return { ...normalized, [baseFinishId]: existing };
  return { ...normalized, [baseFinishId]: [...existing, label] };
}

/** Parses `1700000000.json` (v1) or `1700000000.v2.json` (v2+). */
export function parseFinishFileName(file: string): { baseFinishId: number; version: number } {
  const stem = file.replace(/\.json$/i, "");
  const versioned = VERSIONED_FINISH_STEM_RE.exec(stem);
  if (versioned) {
    return { baseFinishId: Number(versioned[1]), version: Number(versioned[2]) };
  }
  const plain = PLAIN_FINISH_STEM_RE.exec(stem);
  if (plain) {
    return { baseFinishId: Number(plain[1]), version: 1 };
  }
  throw new Error(`Invalid finish archive file name: ${file}`);
}

/** Archive JSON file name for a finish version (`v1` has no suffix). */
export function finishJsonFileName(baseFinishId: number, version: number): string {
  if (version <= 1) return `${baseFinishId}.json`;
  return `${baseFinishId}.v${version}.json`;
}

/** Archive markdown file name paired with {@link finishJsonFileName}. */
export function finishMdFileName(baseFinishId: number, version: number): string {
  return finishJsonFileName(baseFinishId, version).replace(/\.json$/i, ".md");
}

/** Question file paired with a finish archive (`<id>.question.json` or `<id>.question.vN.json`). */
export function finishQuestionsJsonFileName(baseFinishId: number, version: number): string {
  if (version <= 1) return `${baseFinishId}.question.json`;
  return `${baseFinishId}.question.v${version}.json`;
}

/** Version cursor on a finish record (falls back to the file name). */
function finishVersion(file: string, record: FinishRecord): number {
  return record.version ?? parseFinishFileName(file).version;
}

/** Next versioned finish archive names — never overwrites the prior file. */
export function nextFinishVersion(priorFile: string): {
  baseFinishId: number;
  version: number;
  jsonFile: string;
  mdFile: string;
} {
  const { baseFinishId, version } = parseFinishFileName(priorFile);
  const next = version + 1;
  return {
    baseFinishId,
    version: next,
    jsonFile: finishJsonFileName(baseFinishId, next),
    mdFile: finishMdFileName(baseFinishId, next),
  };
}

/** Loads the newest finish archive by `version` cursor, or null. */
export function latestFinish(finishDir: string): { file: string; record: FinishRecord } | null {
  if (!fs.existsSync(finishDir)) return null;

  const ranked = fs
    .readdirSync(finishDir)
    .filter((f) => {
      if (!f.endsWith(".json") || f.includes(".question.")) return false;
      try {
        parseFinishFileName(f);
        return true;
      } catch {
        return false;
      }
    })
    .map((file) => {
      const full = path.join(finishDir, file);
      const record = JSON.parse(fs.readFileSync(full, "utf8")) as FinishRecord;
      return { file, record, version: finishVersion(file, record) };
    })
    .sort((a, b) => b.version - a.version || b.file.localeCompare(a.file));

  const top = ranked[0];
  if (!top) return null;
  return { file: top.file, record: top.record };
}

/** Loads a prepared record by file name inside `preparedDir`. */
export function loadPreparedRecord(
  preparedDir: string,
  file: string,
): { file: string; record: PreparedRecord } {
  const preparedPath = path.join(preparedDir, file);
  if (!fs.existsSync(preparedPath)) {
    throw new Error(`Prepared record not found: ${preparedPath}`);
  }
  return {
    file,
    record: JSON.parse(fs.readFileSync(preparedPath, "utf8")) as PreparedRecord,
  };
}

/** Loads a report record by file name inside `reportsDir`. */
export function loadReportRecord(
  reportsDir: string,
  file: string,
): { file: string; record: ReportRecord } {
  const reportPath = path.join(reportsDir, file);
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }
  return {
    file,
    record: JSON.parse(fs.readFileSync(reportPath, "utf8")) as ReportRecord,
  };
}

/** Default RECONSTRUCTION markdown file name for cwd output. */
export function defaultReconstructionName(repoPath: string, period?: string): string {
  const projectName = path.basename(repoPath);
  return period ? `RECONSTRUCTION.${projectName}.${period}.md` : `RECONSTRUCTION.${projectName}.md`;
}

/** Version-suffixed RECONSTRUCTION name for a deepened finish (optional cwd output). */
export function versionedReconstructionName(
  repoPath: string,
  version: number,
  period?: string,
): string {
  const projectName = path.basename(repoPath);
  const base = period ? `RECONSTRUCTION.${projectName}.${period}` : `RECONSTRUCTION.${projectName}`;
  return version <= 1 ? `${base}.md` : `${base}.v${version}.md`;
}
