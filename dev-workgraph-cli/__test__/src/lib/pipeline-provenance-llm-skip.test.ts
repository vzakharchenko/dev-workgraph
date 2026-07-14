// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJsonFromSchema } from "../helpers/action-fixtures.js";
import { writeMigrationJson, testMigrationContext } from "../helpers/migration-fixtures.js";
import { testLlmSlots } from "../helpers/pipeline-provenance-llm-fixtures.js";
import {
  backfillPipelineProvenanceArtifact,
  runPipelineProvenanceLlmBackfill,
  needsPipelineProvenanceLlmBackfill,
} from "../../../src/lib/migrations/steps/pipeline-provenance-llm.js";
import { TokenUsageTracker } from "../../../src/lib/token-usage.js";

vi.mock("../../../src/lib/ollama.js", () => ({
  chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
    chatJsonFromSchema(opts.schema),
  ),
}));

describe("pipeline provenance LLM backfill skip paths", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("backfillPipelineProvenanceArtifact returns false without narrative slot", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-skip-"));
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
    };
    const tracker = new TokenUsageTracker(tmpDir);
    expect(
      await backfillPipelineProvenanceArtifact(
        path.join(tmpDir, "prepared", "1.json"),
        "prepared",
        ctx,
        tracker,
      ),
    ).toBe(false);
  });

  it("backfillPipelineProvenanceArtifact skips dry run and empty prepared analyses", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-skip2-"));
    const preparedPath = path.join(tmpDir, "prepared", "1.json");
    writeMigrationJson(preparedPath, {
      preparedId: 1,
      sourceReport: "1.json",
      groupCount: 0,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "low",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [],
        questionsAnalyses: [],
        confidence: "low",
        history: "",
        provenance: { model: "t", generatedAt: "x", sourceReport: "1.json" },
      },
    });
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: true,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    const tracker = new TokenUsageTracker(tmpDir);
    expect(await backfillPipelineProvenanceArtifact(preparedPath, "prepared", ctx, tracker)).toBe(
      false,
    );
  });

  it("backfillPipelineProvenanceArtifact fills prepared artifact lineage", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-prepared-"));
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const reportId = 1_700_000_300;
    writeMigrationJson(path.join(reportsDir, `${reportId}.json`), {
      reportId,
      sourceGroups: [],
      groupCount: 0,
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
        linesAdded: 0,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
        historySource: [],
      },
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: {
          technical: [{ text: "Core change", sourceGroupIds: [reportId], sourceCommits: [] }],
          architecture: [],
          security: [],
        },
        questionsAnalyses: [],
        confidence: "medium",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      },
      history: [{ text: "work" }],
    });
    const preparedPath = path.join(preparedDir, `${reportId}.json`);
    writeMigrationJson(preparedPath, {
      preparedId: reportId,
      sourceReport: `${reportId}.json`,
      groupCount: 0,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [
          { text: "Core change", sourceGroupIds: [reportId], sourceCommits: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
        ],
        questionsAnalyses: [
          {
            observation: ["Module changed"],
            missingPiece: ["Intent"],
            question: ["Why change?"],
          },
        ],
        confidence: "medium",
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${reportId}.json` },
      },
      schemaVersion: 1_000_006,
    });
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir,
      preparedDir,
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    const tracker = new TokenUsageTracker(tmpDir);
    tracker.beginStep("migrate");
    const changed = await backfillPipelineProvenanceArtifact(
      preparedPath,
      "prepared",
      ctx,
      tracker,
    );
    tracker.endStep();
    expect(changed).toBe(true);
    const repaired = JSON.parse(fs.readFileSync(preparedPath, "utf8")) as {
      model: { questionsAnalyses: { lineageKind?: string }[] };
    };
    expect(repaired.model.questionsAnalyses[0]?.lineageKind).toBeDefined();
  });

  it("backfillPipelineProvenanceArtifact skips when report is missing", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-noreport-"));
    const preparedPath = path.join(tmpDir, "prepared", "9.json");
    writeMigrationJson(preparedPath, {
      preparedId: 9,
      sourceReport: "missing.json",
      groupCount: 0,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "low",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [],
        questionsAnalyses: [
          { observation: ["x"], missingPiece: ["y"], question: ["z?"] },
        ],
        confidence: "low",
        history: "",
        provenance: { model: "t", generatedAt: "x", sourceReport: "missing.json" },
      },
    });
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    const tracker = new TokenUsageTracker(tmpDir);
    expect(await backfillPipelineProvenanceArtifact(preparedPath, "prepared", ctx, tracker)).toBe(
      false,
    );
  });

  it("backfillPipelineProvenanceArtifact skips finish file when prepared is missing", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-noprep-"));
    const finishPath = path.join(tmpDir, "finish", "9.question.json");
    writeMigrationJson(finishPath, {
      sourceFinal: "9.json",
      sourceReport: "9.json",
      questions: [{ id: "1", question: "Q?", threadIndex: 0 }],
      questionsAnalyses: [
        { observation: ["x"], missingPiece: ["y"], question: ["Q?"], threadIndex: 0 },
      ],
    });
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    const tracker = new TokenUsageTracker(tmpDir);
    expect(
      await backfillPipelineProvenanceArtifact(finishPath, "finish-questions", ctx, tracker),
    ).toBe(false);
  });

  it("backfillPipelineProvenanceArtifact continues when evidence polish fails", async () => {
    const { chatJson } = await import("../../../src/lib/ollama.js");
    vi.mocked(chatJson).mockImplementation(async (opts) => {
      const required = (opts.schema as { required?: string[] }).required ?? [];
      if (required.includes("evidenceExcerpts")) {
        throw new Error("polish failed");
      }
      return chatJsonFromSchema(opts.schema);
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-polish-"));
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const finishDir = path.join(tmpDir, "finish");
    const reportId = 1_700_000_400;
    writeMigrationJson(path.join(reportsDir, `${reportId}.json`), {
      reportId,
      sourceGroups: [],
      groupCount: 0,
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
        linesAdded: 0,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
        historySource: [],
      },
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: {
          technical: [{ text: "Change", sourceGroupIds: [reportId], sourceCommits: [] }],
          architecture: [],
          security: [],
        },
        questionsAnalyses: [],
        confidence: "medium",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      },
      history: [{ text: "work" }],
    });
    writeMigrationJson(path.join(preparedDir, `${reportId}.json`), {
      preparedId: reportId,
      sourceReport: `${reportId}.json`,
      groupCount: 0,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [
          { text: "Change", sourceGroupIds: [reportId], sourceCommits: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
        ],
        questionsAnalyses: [
          { observation: ["x"], missingPiece: ["y"], question: ["Q?"] },
        ],
        confidence: "medium",
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${reportId}.json` },
      },
      schemaVersion: 1_000_006,
    });
    const finishPath = path.join(finishDir, `${reportId}.question.json`);
    writeMigrationJson(finishPath, {
      sourceFinal: `${reportId}.json`,
      sourceReport: `${reportId}.json`,
      questions: [{ id: "1", question: "Q?", threadIndex: 0 }],
      questionsAnalyses: [{ observation: ["x"], missingPiece: ["y"], question: ["Q?"] }],
    });
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir,
      preparedDir,
      finishDir,
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    const tracker = new TokenUsageTracker(tmpDir);
    tracker.beginStep("migrate");
    const changed = await backfillPipelineProvenanceArtifact(
      finishPath,
      "finish-questions",
      ctx,
      tracker,
    );
    tracker.endStep();
    expect(changed).toBe(true);
  });

  it("runPipelineProvenanceLlmBackfill returns zero in dry run", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-dry-"));
    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: true,
      backup: false,
      llmSlots: testLlmSlots(),
    };
    expect(await runPipelineProvenanceLlmBackfill(ctx)).toBe(0);
  });

  it("needsPipelineProvenanceLlmBackfill ignores threads without question text", () => {
    expect(
      needsPipelineProvenanceLlmBackfill([
        { observation: ["  "], missingPiece: [], question: [] },
      ]),
    ).toBe(false);
  });
});
