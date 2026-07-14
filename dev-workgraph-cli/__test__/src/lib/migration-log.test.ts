// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  logLlmBackfillFile,
  logLlmBackfillHeader,
  logLlmBackfillSkip,
  logLlmSubstep,
  logLlmSubstepDone,
  logMigrationPhase,
  logStructuralFileChanged,
  logStructuralKindHeader,
  logStructuralKindSummary,
  relArtifactPath,
} from "../../../src/lib/migrations/migration-log.js";

describe("migration-log", () => {
  it("relArtifactPath falls back to basename outside data root", () => {
    expect(relArtifactPath("/other/data/groups/1.json", "/tmp/root")).toBe("1.json");
    expect(relArtifactPath("/tmp/root/groups/1.json", "/tmp/root")).toBe("groups/1.json");
  });

  it("logs structural and LLM phases", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    logMigrationPhase("Phase 1");
    logStructuralKindHeader("group", 2);
    logStructuralFileChanged("/tmp/root/groups/1.json", "/tmp/root", 0, 1_000_006, ["provenance"]);
    logStructuralKindSummary(0, 3);
    logStructuralKindSummary(0, 0);
    logLlmBackfillHeader("test-model", "http://127.0.0.1:11434");
    logLlmBackfillFile("prepared/1.json");
    logLlmBackfillSkip("already present");
    logLlmSubstep("[1/3] working");
    logLlmSubstepDone("ok");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Phase 1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("legacy → 1.0.6"));
    expect(log).toHaveBeenCalledWith("  (none)");
    expect(log).toHaveBeenCalledWith("  (all up to date)");
    expect(stdout).toHaveBeenCalled();
    log.mockRestore();
    stdout.mockRestore();
  });
});
