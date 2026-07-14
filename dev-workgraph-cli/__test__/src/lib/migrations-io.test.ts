// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION } from "../../../src/lib/version.js";
import {
  backupArtifactFile,
  listFinishArchiveFiles,
  listFinishQuestionFiles,
  listJsonFiles,
  readSchemaVersion,
  stampSchemaVersionOnly,
  writeMigratedRecord,
} from "../../../src/lib/migrations/io.js";

describe("migrations io", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readSchemaVersion treats missing field as legacy 0", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-io-"));
    const file = path.join(tmpDir, "legacy.json");
    fs.writeFileSync(file, '{"groupId":1}\n');
    expect(readSchemaVersion(file)).toBe(0);
  });

  it("backupArtifactFile copies once and skips existing backup", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-io-"));
    const file = path.join(tmpDir, "artifact.json");
    fs.writeFileSync(file, '{"schemaVersion":1}\n');
    backupArtifactFile(file, 1);
    const backup = `${file}.bak.1`;
    expect(fs.existsSync(backup)).toBe(true);
    fs.writeFileSync(file, '{"schemaVersion":2}\n');
    backupArtifactFile(file, 1);
    expect(fs.readFileSync(backup, "utf8")).toContain('"schemaVersion":1');
  });

  it("writeMigratedRecord respects dryRun", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-io-"));
    const file = path.join(tmpDir, "out.json");
    writeMigratedRecord(file, { schemaVersion: 2 }, true);
    expect(fs.existsSync(file)).toBe(false);
    writeMigratedRecord(file, { schemaVersion: 2 }, false);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ schemaVersion: VERSION });
  });

  it("stampSchemaVersionOnly updates version unless dryRun", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-io-"));
    const file = path.join(tmpDir, "stamp.json");
    fs.writeFileSync(file, '{"schemaVersion":1,"payload":true}\n');
    expect(stampSchemaVersionOnly(file, true)).toBe(VERSION);
    expect(readSchemaVersion(file)).toBe(1);
    expect(stampSchemaVersionOnly(file, false)).toBe(VERSION);
    expect(readSchemaVersion(file)).toBe(VERSION);
  });

  it("listJsonFiles and finish helpers partition finish directory", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-io-"));
    expect(listJsonFiles(path.join(tmpDir, "missing"))).toEqual([]);
    const finishDir = path.join(tmpDir, "finish");
    fs.mkdirSync(finishDir, { recursive: true });
    fs.writeFileSync(path.join(finishDir, "1.json"), "{}");
    fs.writeFileSync(path.join(finishDir, "1.question.json"), "{}");
    const all = listJsonFiles(finishDir);
    expect(all).toHaveLength(2);
    expect(listFinishQuestionFiles(finishDir)).toEqual([path.join(finishDir, "1.question.json")]);
    expect(listFinishArchiveFiles(finishDir)).toEqual([path.join(finishDir, "1.json")]);
  });
});
