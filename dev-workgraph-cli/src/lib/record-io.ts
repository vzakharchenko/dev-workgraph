// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { VERSION } from "./version.js";

/** Stamps the current CLI schema version onto a JSON record before write. */
export function stampSchemaVersion<T extends object>(record: T): T & { schemaVersion: number } {
  return { ...record, schemaVersion: VERSION };
}

/** Writes a stamped JSON record (pretty-printed, trailing newline). */
export function writeRecordJson(filePath: string, record: object): void {
  fs.writeFileSync(filePath, `${JSON.stringify(stampSchemaVersion(record), null, 2)}\n`, "utf8");
}
