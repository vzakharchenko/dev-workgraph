// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeMigrationContext, detectArtifactKind } from "../../../src/lib/migrations/detect.js";

describe("migrations detect", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detectArtifactKind uses bucket dir hints when path is non-standard", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-detect-"));
    const groupsDir = path.join(tmpDir, "groups");
    const filePath = path.join(groupsDir, "custom-name.json");
    expect(detectArtifactKind(filePath, { groupsDir })).toBe("group");
    expect(detectArtifactKind(path.join(tmpDir, "finish", "1.question.v2.json"), { finishDir: path.join(tmpDir, "finish") })).toBe(
      "finish-questions",
    );
    expect(detectArtifactKind(path.join(tmpDir, "finish", "1.v2.json"), { finishDir: path.join(tmpDir, "finish") })).toBe(
      "finish",
    );
  });

  it("detectArtifactKind recognizes extensionless question filenames", () => {
    expect(detectArtifactKind("/data/finish/1700000000.question.v3.json")).toBe("finish-questions");
  });

  it("completeMigrationContext builds dirs from data root", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-detect-ctx-"));
    const filePath = path.join(tmpDir, "groups", "1.json");
    const ctx = completeMigrationContext(filePath);
    expect(ctx?.dataRoot).toBe(tmpDir);
    expect(ctx?.groupsDir).toBe(path.join(tmpDir, "groups"));
    expect(ctx?.reportsDir).toBe(path.join(tmpDir, "reports"));
  });

  it("completeMigrationContext returns null when data root cannot be inferred", () => {
    expect(completeMigrationContext("/tmp/nowhere/file.json")).toBeNull();
  });

  it("completeMigrationContext resolves dirs from bucket hints", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-detect-hints-"));
    const reportsDir = path.join(tmpDir, "custom-reports");
    const ctx = completeMigrationContext(path.join(reportsDir, "orphan.json"), { reportsDir });
    expect(ctx?.reportsDir).toBe(reportsDir);
    expect(ctx?.dataRoot).toBe(reportsDir);
  });
});
