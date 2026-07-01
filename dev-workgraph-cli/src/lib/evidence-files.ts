// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

const EVIDENCE_PART_JSON_RE = /\.part\d+\.json$/;
const SUMMARY_NON_CANONICAL_JSON_RE = /\.(part\d+|merge)\.json$/;

/**
 * True for commit manifest JSON (`<hash>.json`), false for split part files (`<hash>.partN.json`).
 * @param filename - Basename of a file under `commits/<timestamp>/`.
 */
export function isCommitEvidenceManifestFile(filename: string): boolean {
  return filename.endsWith(".json") && !EVIDENCE_PART_JSON_RE.test(filename);
}

/**
 * True for canonical per-commit summary JSON (`<hash>.json`), false for split part or merge files.
 * @param filename - Basename of a file under `summaries/<timestamp>/`.
 */
export function isCanonicalCommitSummaryFile(filename: string): boolean {
  return filename.endsWith(".json") && !SUMMARY_NON_CANONICAL_JSON_RE.test(filename);
}
