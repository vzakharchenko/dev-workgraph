// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import type { MigrationArtifactKind, MigrationContext } from "./types.js";

const ARTIFACT_DIR_NAMES = ["groups", "reports", "prepared", "finish"] as const;

/** Infers repo data root from an artifact file path. */
function inferDataRootFromArtifact(filePath: string): string | null {
  const normalized = path.normalize(filePath);
  for (const dirName of ARTIFACT_DIR_NAMES) {
    const needle = `${path.sep}${dirName}${path.sep}`;
    const idx = normalized.lastIndexOf(needle);
    if (idx >= 0) return normalized.slice(0, idx);
  }
  const parentName = path.basename(path.dirname(normalized));
  if (ARTIFACT_DIR_NAMES.includes(parentName as (typeof ARTIFACT_DIR_NAMES)[number])) {
    return path.dirname(path.dirname(normalized));
  }
  return null;
}

function detectFromStandardPath(filePath: string): MigrationArtifactKind | null {
  const normalized = path.normalize(filePath);
  const base = path.basename(filePath);
  if (/\/groups\/[^/]+\.json$/i.test(normalized)) return "group";
  if (/\/reports\/[^/]+\.json$/i.test(normalized)) return "report";
  if (/\/prepared\/[^/]+\.json$/i.test(normalized)) return "prepared";
  if (/\/finish\/[^/]+\.question(\.v\d+)?\.json$/i.test(normalized)) return "finish-questions";
  if (/\/finish\/[^/]+(\.v\d+)?\.json$/i.test(normalized) && !base.includes(".question")) {
    return "finish";
  }
  const parentName = path.basename(path.dirname(normalized));
  if (parentName === "groups") return "group";
  if (parentName === "reports") return "report";
  if (parentName === "prepared") return "prepared";
  if (parentName === "finish") {
    return base.includes(".question") ? "finish-questions" : "finish";
  }
  if (/\.question(?:\.v\d+)?\.json$/i.test(base)) return "finish-questions";
  return null;
}

/** Detects pipeline artifact kind from a JSON file path (optionally using bucket dir hints). */
export function detectArtifactKind(
  filePath: string,
  hints?: Partial<MigrationContext>,
): MigrationArtifactKind | null {
  const fromPath = detectFromStandardPath(filePath);
  if (fromPath) return fromPath;
  const base = path.basename(filePath);
  if (hints?.groupsDir && filePath.startsWith(path.normalize(hints.groupsDir))) return "group";
  if (hints?.reportsDir && filePath.startsWith(path.normalize(hints.reportsDir))) return "report";
  if (hints?.preparedDir && filePath.startsWith(path.normalize(hints.preparedDir)))
    return "prepared";
  if (hints?.finishDir && filePath.startsWith(path.normalize(hints.finishDir))) {
    return base.includes(".question") ? "finish-questions" : "finish";
  }
  return null;
}

function bucketDataRoot(bucketDir: string, standardName: string): string {
  return path.basename(bucketDir) === standardName ? path.dirname(bucketDir) : bucketDir;
}

/** Resolves data root from explicit hints or artifact path. */
function resolveDataRoot(filePath: string, hints: Partial<MigrationContext> = {}): string | null {
  if (hints.dataRoot) return hints.dataRoot;
  const fromPath = inferDataRootFromArtifact(filePath);
  if (fromPath) return fromPath;
  if (hints.groupsDir) return bucketDataRoot(hints.groupsDir, "groups");
  if (hints.reportsDir) return bucketDataRoot(hints.reportsDir, "reports");
  if (hints.preparedDir) return bucketDataRoot(hints.preparedDir, "prepared");
  if (hints.finishDir) return bucketDataRoot(hints.finishDir, "finish");
  return null;
}

/** Builds a full migration context from path hints (used by lazy loaders). */
export function completeMigrationContext(
  filePath: string,
  hints: Partial<MigrationContext> = {},
): MigrationContext | null {
  const dataRoot = resolveDataRoot(filePath, hints);
  if (!dataRoot) return null;

  const groupsDir =
    hints.groupsDir ??
    (path.basename(path.dirname(filePath)) === "groups"
      ? path.dirname(filePath)
      : path.join(dataRoot, "groups"));
  const reportsDir = hints.reportsDir ?? path.join(dataRoot, "reports");
  const preparedDir = hints.preparedDir ?? path.join(dataRoot, "prepared");
  const finishDir =
    hints.finishDir ??
    (path.basename(path.dirname(filePath)) === "finish"
      ? path.dirname(filePath)
      : path.join(dataRoot, "finish"));

  return {
    repoPath: hints.repoPath ?? "",
    period: hints.period,
    dataRoot,
    groupsDir: hints.groupsDir ?? groupsDir,
    reportsDir: hints.reportsDir ?? reportsDir,
    preparedDir: hints.preparedDir ?? preparedDir,
    finishDir: hints.finishDir ?? finishDir,
    summariesDir: hints.summariesDir ?? path.join(dataRoot, "summaries"),
    dryRun: hints.dryRun ?? false,
    backup: hints.backup ?? false,
  };
}
