// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJsonFromSchema } from "../helpers/action-fixtures.js";
import { writeMigrationJson, testMigrationContext } from "../helpers/migration-fixtures.js";
import { testLlmSlots } from "../helpers/pipeline-provenance-llm-fixtures.js";
import { migrateRepo } from "../../../src/lib/migrations/index.js";
import {
  needsPipelineProvenanceLlmBackfill,
  backfillPipelineProvenanceArtifact,
} from "../../../src/lib/migrations/steps/pipeline-provenance-llm.js";
import { TokenUsageTracker } from "../../../src/lib/token-usage.js";

vi.mock("../../../src/lib/ollama.js", () => ({
  chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
    chatJsonFromSchema(opts.schema),
  ),
}));

describe("pipeline provenance LLM backfill", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("needsPipelineProvenanceLlmBackfill detects missing derived refs", () => {
    expect(
      needsPipelineProvenanceLlmBackfill([
        {
          observation: ["x"],
          missingPiece: ["y"],
          question: ["z?"],
        },
      ]),
    ).toBe(true);
    expect(
      needsPipelineProvenanceLlmBackfill([
        {
          observation: ["x"],
          missingPiece: ["y"],
          question: ["z?"],
          derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
        },
      ]),
    ).toBe(false);
  });

  it("backfillPipelineProvenanceArtifact fills finish question lineage via LLM", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-"));
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const finishDir = path.join(tmpDir, "finish");
    const reportId = 1_700_000_100;

    writeMigrationJson(path.join(reportsDir, `${reportId}.json`), {
      reportId,
      sourceGroups: [`${reportId}.json`],
      groupCount: 1,
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
          technical: [{ text: "Auth refactor", sourceGroupIds: [reportId], sourceCommits: [] }],
          architecture: [],
          security: [],
        },
        questionsAnalyses: [
          {
            observation: ["Auth changed"],
            missingPiece: ["Prod unknown"],
            question: ["Deployed?"],
            threadId: `${reportId}000000`,
            sourceGroupIds: [reportId],
          },
        ],
        confidence: "medium",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      },
      history: [{ text: "work" }],
      schemaVersion: 1_000_005,
    });

    writeMigrationJson(path.join(preparedDir, `${reportId}.json`), {
      preparedId: reportId,
      sourceReport: `${reportId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [
          { text: "Auth refactor", sourceGroupIds: [reportId], sourceCommits: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
        ],
        questionsAnalyses: [
          {
            observation: ["Auth module"],
            missingPiece: ["Prod rollout"],
            question: ["Was auth deployed?"],
            threadIndex: 0,
          },
        ],
        confidence: "medium",
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${reportId}.json` },
      },
      schemaVersion: 1_000_006,
    });

    const finishQuestionsPath = path.join(finishDir, `${reportId}.question.json`);
    writeMigrationJson(finishQuestionsPath, {
      sourceFinal: `${reportId}.json`,
      sourceReport: `${reportId}.json`,
      questions: [
        {
          id: "1",
          question: "Was auth deployed?",
          threadIndex: 0,
          sourceGroupIds: [],
          sourceCommits: [],
        },
      ],
      questionsAnalyses: [
        {
          observation: ["Auth module"],
          missingPiece: ["Prod rollout"],
          question: ["Was auth deployed?"],
          threadIndex: 0,
        },
      ],
      schemaVersion: 1_000_006,
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
      finishQuestionsPath,
      "finish-questions",
      ctx,
      tracker,
    );
    tracker.endStep();
    expect(changed).toBe(true);

    const repaired = JSON.parse(fs.readFileSync(finishQuestionsPath, "utf8")) as {
      questionsAnalyses: { lineageKind?: string; sourceGroupIds?: number[] }[];
      questions: { sourceGroupIds?: number[]; evidenceExcerpt?: string }[];
    };
    expect(repaired.questionsAnalyses[0]?.lineageKind).toBeDefined();
    expect(repaired.questionsAnalyses[0]?.sourceGroupIds?.length).toBeGreaterThan(0);
    expect(repaired.questions[0]?.sourceGroupIds?.length).toBeGreaterThan(0);
    expect(repaired.questions[0]?.evidenceExcerpt).toBeTruthy();
  });

  it("migrateRepo runs LLM backfill when ctx.llmSlots is set", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-llm-repo-"));
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const finishDir = path.join(tmpDir, "finish");
    const reportId = 1_700_000_200;

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
        technicalSignal: "low",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: { technical: [], architecture: [], security: [] },
        questionsAnalyses: [],
        confidence: "low",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      },
      history: [],
      schemaVersion: 1_000_006,
    });

    writeMigrationJson(path.join(preparedDir, `${reportId}.json`), {
      preparedId: reportId,
      sourceReport: `${reportId}.json`,
      groupCount: 0,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "low",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [
          { text: "slot0", sourceGroupIds: [reportId], sourceCommits: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
          { text: "", sourceGroupIds: [] },
        ],
        confidence: "low",
        history: "h",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${reportId}.json` },
      },
      schemaVersion: 1_000_006,
    });

    writeMigrationJson(path.join(finishDir, `${reportId}.question.json`), {
      sourceFinal: `${reportId}.json`,
      sourceReport: `${reportId}.json`,
      questions: [{ id: "1", question: "Q?", threadIndex: 0 }],
      questionsAnalyses: [
        {
          observation: ["obs"],
          missingPiece: ["gap"],
          question: ["Q?"],
          threadIndex: 0,
        },
      ],
      schemaVersion: 1_000_006,
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

    const report = await migrateRepo(ctx);
    expect(report.errors).toEqual([]);
    expect(report.files.some((f) => f.file === "(pipeline-provenance-llm)" && f.changed)).toBe(
      true,
    );
  });
});
