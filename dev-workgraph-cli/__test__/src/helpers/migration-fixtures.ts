// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import type { MigrationContext } from "../../../src/lib/migrations/types.js";

export function writeMigrationJson(filePath: string, record: object): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function testMigrationContext(
  tmpDir: string,
  overrides: Partial<MigrationContext> = {},
): MigrationContext {
  return {
    repoPath: tmpDir,
    dataRoot: tmpDir,
    groupsDir: path.join(tmpDir, "groups"),
    reportsDir: path.join(tmpDir, "reports"),
    preparedDir: path.join(tmpDir, "prepared"),
    finishDir: path.join(tmpDir, "finish"),
    summariesDir: path.join(tmpDir, "summaries"),
    dryRun: false,
    backup: false,
    ...overrides,
  };
}
