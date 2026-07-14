// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildMigrationContextMock,
  migrateRepoMock,
  resolvePipelineLlmSlotsMock,
} = vi.hoisted(() => ({
  buildMigrationContextMock: vi.fn(),
  migrateRepoMock: vi.fn(),
  resolvePipelineLlmSlotsMock: vi.fn(),
}));

vi.mock("../../../src/lib/migrations/index.js", () => ({
  buildMigrationContext: buildMigrationContextMock,
  migrateRepo: migrateRepoMock,
}));

vi.mock("../../../src/lib/resolve-pipeline-llm-slots.js", () => ({
  resolvePipelineLlmSlots: resolvePipelineLlmSlotsMock,
}));

import { migrate } from "../../../src/actions/migrate.js";

const cliRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = execFileSync("git", ["-C", cliRoot, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

describe("migrate action", () => {
  beforeEach(() => {
    buildMigrationContextMock.mockReset();
    migrateRepoMock.mockReset();
    resolvePipelineLlmSlotsMock.mockReset();
    buildMigrationContextMock.mockReturnValue({
      repoPath: repoRoot,
      dataRoot: "/tmp/data",
      groupsDir: "/tmp/data/groups",
      reportsDir: "/tmp/data/reports",
      preparedDir: "/tmp/data/prepared",
      finishDir: "/tmp/data/finish",
      summariesDir: "/tmp/data/summaries",
      dryRun: false,
      backup: false,
    });
    migrateRepoMock.mockResolvedValue({ files: [], errors: [] });
    resolvePipelineLlmSlotsMock.mockResolvedValue({
      commit: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "test" },
      report: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "test" },
      narrative: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "test" },
    });
  });

  it("resolves LLM slots and runs migrateRepo", async () => {
    migrateRepoMock.mockResolvedValue({
      files: [{ file: "g.json", kind: "group", fromVersion: 1, toVersion: 2, changed: true }],
      errors: [],
    });

    await migrate({ repo: repoRoot });

    expect(buildMigrationContextMock).toHaveBeenCalled();
    expect(resolvePipelineLlmSlotsMock).toHaveBeenCalled();
    expect(migrateRepoMock).toHaveBeenCalled();
    const ctx = migrateRepoMock.mock.calls[0]?.[0] as { llmSlots?: unknown };
    expect(ctx.llmSlots).toBeDefined();
  });

  it("skips LLM slot resolution when skipLlm is set", async () => {
    await migrate({ repo: repoRoot, skipLlm: true });
    expect(resolvePipelineLlmSlotsMock).not.toHaveBeenCalled();
    const ctx = migrateRepoMock.mock.calls[0]?.[0] as { llmSlots?: unknown };
    expect(ctx.llmSlots).toBeUndefined();
  });

  it("skips LLM slot resolution in dry run", async () => {
    await migrate({ repo: repoRoot, dryRun: true });
    expect(resolvePipelineLlmSlotsMock).not.toHaveBeenCalled();
  });

  it("throws when migrateRepo reports errors", async () => {
    migrateRepoMock.mockResolvedValue({
      files: [],
      errors: [{ file: "bad.json", message: "boom" }],
    });
    await expect(migrate({ repo: repoRoot, skipLlm: true })).rejects.toThrow(
      "Migration failed for 1 file(s)",
    );
  });
});
