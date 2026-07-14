// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDeterministic, sampleModel } from "../../helpers.js";
import {
  buildMigrationContext,
  detectArtifactKind,
  migrateFile,
  migrateRepo,
  MIGRATION_STEP_KINDS,
} from "../../../src/lib/migrations/index.js";
import { FINISH_QUESTIONS_ANALYSES_VERSION } from "../../../src/lib/migrations/steps/v1000006-finish-questions-analyses.js";
import { PIPELINE_PROVENANCE_VERSION } from "../../../src/lib/migrations/steps/v1000005-pipeline-provenance.js";
import { VERSION } from "../../../src/lib/version.js";

describe("migrations registry", () => {
  it("MIGRATION_STEP_KINDS is sorted by toVersion", () => {
    const versions = MIGRATION_STEP_KINDS.map((step) => step.toVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("detectArtifactKind recognizes pipeline paths", () => {
    expect(detectArtifactKind("/data/groups/1.json")).toBe("group");
    expect(detectArtifactKind("/data/reports/1.json")).toBe("report");
    expect(detectArtifactKind("/data/prepared/1.json")).toBe("prepared");
    expect(detectArtifactKind("/data/finish/1.question.json")).toBe("finish-questions");
    expect(detectArtifactKind("/data/finish/1.json")).toBe("finish");
  });
});

describe("pipeline provenance migration v1000005", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJson(filePath: string, record: object): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  it("migrates group → report → prepared chain with provenance", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-"));
    const groupsDir = path.join(tmpDir, "groups");
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const summariesDir = path.join(tmpDir, "summaries");
    const finishDir = path.join(tmpDir, "finish");

    const groupId = 1_700_000_000;
    const model = sampleModel({
      signalReasons: { technical: "Core auth logic changed", architecture: "", security: "" },
    });

    writeJson(path.join(summariesDir, "100", "abc.json"), {
      commitHash: "abc",
      timestamp: 100,
      sourceEvidence: "100",
      model,
    });

    writeJson(path.join(groupsDir, `${groupId}.json`), {
      groupId,
      timestampStart: groupId - 1000,
      timestampEnd: groupId,
      commitCount: 1,
      groups: {
        commits: ["abc"],
        tiers: { low: [], medium: [], hi: ["abc"] },
        sourceEvidence: ["100"],
        sourceSummaries: ["summaries/100/abc.json"],
      },
      deterministic: emptyDeterministic({
        changedFiles: { added: [], deleted: [], modified: ["a.ts"], renamed: [] },
        linesAdded: 1,
      }),
      model: {
        ...model,
        history: "Worked on auth",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
        questionsAnalyses: [
          {
            observation: ["Auth module refactored"],
            missingPiece: ["Production rollout unknown"],
            question: ["Was this deployed?"],
          },
        ],
      },
      schemaVersion: 1_000_004,
    });

    writeJson(path.join(reportsDir, `${groupId}.json`), {
      reportId: groupId,
      sourceGroups: [`${groupId}.json`],
      groupCount: 1,
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: ["a.ts"], renamed: [] },
        linesAdded: 1,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
        historySource: [[`${groupId}.json`]],
      },
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: {
          technical: ["Core auth logic changed"],
          architecture: [],
          security: [],
        },
        questionsAnalyses: [
          {
            observation: ["Auth module refactored"],
            missingPiece: ["Production rollout unknown"],
            question: ["Was this deployed?"],
            threadId: "1700000000000000",
            sourceGroupIds: [groupId],
            sourceCommits: ["abc"],
          },
        ],
        confidence: "medium",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      },
      history: [{ text: "Worked on auth" }],
      schemaVersion: 1_000_004,
    });

    writeJson(path.join(preparedDir, `${groupId}.json`), {
      preparedId: groupId,
      sourceReport: `${groupId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: ["Core auth logic changed", "Reason two", "Reason three", "Reason four"],
        questionsAnalyses: [
          {
            observation: ["Auth refactor"],
            missingPiece: ["Production rollout unknown"],
            question: ["Was auth deployed to production?"],
            derivedFromThreadIds: ["1700000000000000"],
            derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
          },
        ],
        confidence: "medium",
        history: "Auth work",
        provenance: {
          model: "test",
          generatedAt: "2026-01-01T00:00:00.000Z",
          sourceReport: `${groupId}.json`,
        },
      },
      schemaVersion: 1_000_004,
    });

    writeJson(path.join(finishDir, `${groupId}.question.json`), {
      sourceFinal: `${groupId}.json`,
      sourceReport: `${groupId}.json`,
      questions: [
        {
          id: "1",
          question: "Was auth deployed to production?",
          threadIndex: 0,
        },
      ],
      schemaVersion: 1_000_004,
    });

    writeJson(path.join(finishDir, `${groupId}.json`), {
      finishId: groupId,
      sourcePrepared: `${groupId}.json`,
      sourceReport: `${groupId}.json`,
      project: "demo",
      role: "Senior",
      technologies: [],
      history: "Auth work",
      narrative: ["Did auth work"],
      cvBullets: ["Auth"],
      answers: [],
      sourceQuestions: { [groupId]: ["v1"] },
      outputMarkdown: "RECONSTRUCTION.demo.md",
      version: 1,
      provenance: { model: "test", generatedAt: "2026-01-01T00:00:00.000Z" },
      schemaVersion: 1_000_004,
    });

    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir,
      reportsDir,
      preparedDir,
      finishDir,
      summariesDir,
      dryRun: false,
      backup: false,
    };

    const report = await migrateRepo(ctx);
    expect(report.errors).toEqual([]);
    expect(report.files.filter((f) => f.changed).length).toBeGreaterThan(0);

    const group = JSON.parse(
      fs.readFileSync(path.join(groupsDir, `${groupId}.json`), "utf8"),
    ) as {
      schemaVersion: number;
      model: {
        signalReasons: { technical: { text: string; sourceGroupIds: number[] } };
        questionsAnalyses: { threadId?: string; sourceGroupIds?: number[] }[];
      };
    };
    expect(group.schemaVersion).toBe(VERSION);
    expect(group.model.signalReasons.technical.text).toBe("Core auth logic changed");
    expect(group.model.signalReasons.technical.sourceGroupIds).toContain(groupId);
    expect(group.model.questionsAnalyses[0]?.threadId).toBeTruthy();
    expect(group.model.questionsAnalyses[0]?.sourceGroupIds).toContain(groupId);

    const prepared = JSON.parse(
      fs.readFileSync(path.join(preparedDir, `${groupId}.json`), "utf8"),
    ) as {
      schemaVersion: number;
      model: {
        signalReasons: { text: string; sourceGroupIds: number[] }[];
        questionsAnalyses?: { sourceGroupIds?: number[] }[];
      };
    };
    expect(prepared.schemaVersion).toBe(VERSION);
    expect(prepared.model.signalReasons[0]?.text).toBe("Core auth logic changed");
    expect(prepared.model.signalReasons[0]?.sourceGroupIds).toEqual([]);
    expect(prepared.model.questionsAnalyses ?? []).toHaveLength(0);

    const questions = JSON.parse(
      fs.readFileSync(path.join(finishDir, `${groupId}.question.json`), "utf8"),
    ) as {
      schemaVersion: number;
      questions: { sourceGroupIds?: number[] }[];
      questionsAnalyses: { sourceGroupIds?: number[] }[];
    };
    expect(questions.schemaVersion).toBe(VERSION);
    expect(questions.questionsAnalyses[0]?.sourceGroupIds?.length).toBeGreaterThan(0);
    expect(questions.questions[0]?.sourceGroupIds?.length).toBeGreaterThan(0);

    const finish = JSON.parse(fs.readFileSync(path.join(finishDir, `${groupId}.json`), "utf8")) as {
      schemaVersion: number;
      answers: unknown[];
    };
    expect(finish.schemaVersion).toBeGreaterThanOrEqual(PIPELINE_PROVENANCE_VERSION);
    expect(finish.answers).toEqual([]);
  });

  it("migrates legacy group schema 1000003 with string signal reasons and question cards", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-legacy-group-"));
    const groupsDir = path.join(tmpDir, "groups");
    const summariesDir = path.join(tmpDir, "summaries");
    const groupId = 1_783_577_957;
    const commitHash = "b6ff1f61de3fc6473e1550908063092545ef18f5";

    writeJson(path.join(summariesDir, "1783577173", `${commitHash}.json`), {
      commitHash,
      timestamp: 1_783_577_173,
      sourceEvidence: "1783577173",
      model: sampleModel({
        signalReasons: { technical: "LLM backend refactor", architecture: "Provider registry", security: "" },
        questionsAnalysis: [
          {
            observation: "Added llm module.",
            missingPiece: "Production usage unknown.",
            question: "Was this deployed?",
          },
        ],
      }),
    });

    writeJson(path.join(groupsDir, `${groupId}.json`), {
      groupId,
      timestampStart: 1_783_577_173,
      timestampEnd: groupId,
      commitCount: 1,
      groups: {
        commits: [commitHash],
        tiers: { low: [], medium: [], hi: [commitHash] },
        sourceEvidence: ["1783577173"],
        sourceSummaries: [`summaries/1783577173/${commitHash}.json`],
      },
      deterministic: emptyDeterministic({
        changedFiles: { added: [], deleted: [], modified: ["a.ts"], renamed: [] },
        linesAdded: 10,
      }),
      model: {
        changeTypes: ["feature"],
        technologies: ["TypeScript"],
        technicalSignal: "high",
        architectureSignal: "high",
        securitySignal: "low",
        signalReasons: {
          technical: "The commit refactored LLM integration.",
          architecture: "Provider plugin layer added.",
          security: "",
        },
        confidence: "high",
        history: "Built LLM backend.",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
        questionsAnalyses: [
          {
            observation: ["Added llm module."],
            missingPiece: ["Production usage unknown."],
            question: ["Was the provider layer used in production?"],
          },
        ],
      },
      schemaVersion: 1_000_003,
    });

    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir,
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir: path.join(tmpDir, "finish"),
      summariesDir,
      dryRun: false,
      backup: false,
    };
    migrateFile(path.join(groupsDir, `${groupId}.json`), ctx);

    const group = JSON.parse(
      fs.readFileSync(path.join(groupsDir, `${groupId}.json`), "utf8"),
    ) as {
      schemaVersion: number;
      model: {
        signalReasons: {
          technical: { text: string; sourceGroupIds: number[]; sourceCommits?: string[] };
        };
        questionsAnalyses: {
          threadId?: string;
          sourceGroupIds?: number[];
          sourceCommits?: string[];
        }[];
      };
    };

    expect(group.schemaVersion).toBeGreaterThanOrEqual(PIPELINE_PROVENANCE_VERSION);
    expect(group.model.signalReasons.technical.sourceGroupIds).toContain(groupId);
    expect(group.model.signalReasons.technical.sourceCommits).toContain(commitHash);
    expect(group.model.questionsAnalyses[0]?.threadId).toBe(`${groupId}000000`);
    expect(group.model.questionsAnalyses[0]?.sourceGroupIds).toContain(groupId);
    expect(group.model.questionsAnalyses[0]?.sourceCommits?.length).toBeGreaterThan(0);
  });

  it("repair fixes empty finish question lineage from signal reasons", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-repair-"));
    const groupsDir = path.join(tmpDir, "groups");
    const reportsDir = path.join(tmpDir, "reports");
    const preparedDir = path.join(tmpDir, "prepared");
    const finishDir = path.join(tmpDir, "finish");
    const groupId = 1_783_659_928;

    writeJson(path.join(groupsDir, `${groupId}.json`), {
      groupId,
      timestampStart: groupId - 1000,
      timestampEnd: groupId,
      commitCount: 0,
      groups: {
        commits: [],
        tiers: { low: [], medium: [], hi: [] },
        sourceEvidence: [],
        sourceSummaries: [],
      },
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
        linesAdded: 0,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
      },
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "medium",
        securitySignal: "low",
        signalReasons: {
          technical: { text: "Iterator export", sourceGroupIds: [groupId], sourceCommits: [] },
          architecture: { text: "", sourceGroupIds: [] },
          security: { text: "", sourceGroupIds: [] },
        },
        history: "",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
        questionsAnalyses: [],
        confidence: "medium",
      },
      schemaVersion: 1_000_005,
    });

    writeJson(path.join(reportsDir, `${groupId}.json`), {
      reportId: groupId,
      sourceGroups: [`${groupId}.json`],
      groupCount: 1,
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
        linesAdded: 0,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
        historySource: [[`${groupId}.json`]],
      },
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "medium",
        securitySignal: "low",
        signalReasons: {
          technical: [{ text: "Iterator export", sourceGroupIds: [groupId], sourceCommits: [] }],
          architecture: [],
          security: [],
        },
        questionsAnalyses: [
          {
            observation: ["CI workflow"],
            missingPiece: ["Prod unknown"],
            question: ["CI in prod?"],
            threadId: "1783659928000000",
            sourceGroupIds: [groupId],
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

    writeJson(path.join(preparedDir, `${groupId}.json`), {
      preparedId: groupId,
      sourceReport: `${groupId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "medium",
        securitySignal: "low",
        signalReasons: [
          { text: "Iterator export", sourceGroupIds: [groupId], sourceCommits: [] },
          { text: "Reason two", sourceGroupIds: [groupId], sourceCommits: [] },
          { text: "Reason three", sourceGroupIds: [groupId], sourceCommits: [] },
          { text: "Reason four", sourceGroupIds: [groupId], sourceCommits: [] },
        ],
        questionsAnalyses: [
          {
            observation: ["IteratorFactory added"],
            missingPiece: ["Why Iterator"],
            question: ["Why Iterator pattern?"],
            threadIndex: 0,
            derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
            derivedFromPreparedSignalSlots: [0],
          },
        ],
        confidence: "medium",
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${groupId}.json` },
      },
      schemaVersion: 1_000_005,
    });

    const finishQuestionsPath = path.join(finishDir, `${groupId}.question.json`);
    writeJson(finishQuestionsPath, {
      sourceFinal: `${groupId}.json`,
      sourceReport: `${groupId}.json`,
      questions: [
        {
          id: "1",
          question: "Why Iterator pattern?",
          threadIndex: 0,
          derivedFromThreadIds: [],
          sourceGroupIds: [],
          sourceCommits: [],
        },
      ],
      questionsAnalyses: [
        {
          observation: ["IteratorFactory added"],
          missingPiece: ["Why Iterator"],
          question: ["Why Iterator pattern?"],
          threadIndex: 0,
          derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
          derivedFromPreparedSignalSlots: [0],
        },
      ],
      schemaVersion: FINISH_QUESTIONS_ANALYSES_VERSION,
    });

    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir,
      reportsDir,
      preparedDir,
      finishDir,
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
    };

    migrateFile(finishQuestionsPath, ctx);

    const repaired = JSON.parse(fs.readFileSync(finishQuestionsPath, "utf8")) as {
      questions: { lineageKind?: string; sourceGroupIds?: number[] }[];
      questionsAnalyses: { lineageKind?: string; sourceGroupIds?: number[] }[];
    };
    expect(repaired.questionsAnalyses[0]?.lineageKind).toBe("signal-reason");
    expect(repaired.questionsAnalyses[0]?.sourceGroupIds).toContain(groupId);
    expect(repaired.questions[0]?.lineageKind).toBe("signal-reason");
    expect(repaired.questions[0]?.sourceGroupIds).toContain(groupId);
  });

  it("migrateFile is idempotent", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-idem-"));
    const groupsDir = path.join(tmpDir, "groups");
    const filePath = path.join(groupsDir, "1700000001.json");
    writeJson(filePath, {
      groupId: 1_700_000_001,
      timestampStart: 1_700_000_000,
      timestampEnd: 1_700_000_001,
      commitCount: 0,
      groups: {
        commits: [],
        tiers: { low: [], medium: [], hi: [] },
        sourceEvidence: [],
        sourceSummaries: [],
      },
      deterministic: {
        changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
        linesAdded: 0,
        linesDeleted: 0,
        importantFolders: [],
        areas: [],
        excludedFiles: [],
      },
      model: null,
      schemaVersion: 1_000_004,
    });

    const ctx = buildMigrationContext(tmpDir);
    const first = migrateFile(filePath, ctx);
    const second = migrateFile(filePath, ctx);
    expect(first).toBeGreaterThanOrEqual(PIPELINE_PROVENANCE_VERSION);
    expect(second).toBe(first);
    if (VERSION > PIPELINE_PROVENANCE_VERSION) {
      expect(second).toBe(VERSION);
    }
  });
});

describe("finish questions analyses migration v1000006", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeJson(filePath: string, record: object): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  it("moves prepared questionsAnalyses onto finish question file and strips prepared", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-1006-"));
    const preparedDir = path.join(tmpDir, "prepared");
    const finishDir = path.join(tmpDir, "finish");
    const preparedId = 1_700_000_000;
    const analyses = [
      {
        observation: ["Added scheduler"],
        missingPiece: ["Prod unknown"],
        question: ["Shipped?"],
        threadId: "1700000000000000",
        sourceGroupIds: [preparedId],
      },
    ];

    writeJson(path.join(preparedDir, `${preparedId}.json`), {
      preparedId,
      sourceReport: `${preparedId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: [],
        questionsAnalyses: analyses,
        confidence: "medium",
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${preparedId}.json` },
      },
      schemaVersion: PIPELINE_PROVENANCE_VERSION,
    });

    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir,
      finishDir,
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
    };

    migrateFile(path.join(preparedDir, `${preparedId}.json`), ctx);

    const prepared = JSON.parse(
      fs.readFileSync(path.join(preparedDir, `${preparedId}.json`), "utf8"),
    ) as { model: { questionsAnalyses?: unknown }; schemaVersion: number };
    expect(prepared.model.questionsAnalyses).toBeUndefined();
    expect(prepared.schemaVersion).toBe(FINISH_QUESTIONS_ANALYSES_VERSION);

    const finishQuestionsPath = path.join(finishDir, `${preparedId}.question.json`);
    expect(fs.existsSync(finishQuestionsPath)).toBe(true);
    const finishQuestions = JSON.parse(fs.readFileSync(finishQuestionsPath, "utf8")) as {
      questionsAnalyses: unknown[];
      questions: { question: string }[];
    };
    expect(finishQuestions.questionsAnalyses).toHaveLength(1);
    expect(finishQuestions.questions[0]?.question).toBe("Shipped?");
  });

  it("backfills finish question analyses from legacy question cards", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-migrate-1006-legacy-"));
    const finishDir = path.join(tmpDir, "finish");
    const finishId = 1_700_000_001;
    const finishPath = path.join(finishDir, `${finishId}.question.json`);
    writeJson(finishPath, {
      sourceFinal: `${finishId}.json`,
      sourceReport: `${finishId}.json`,
      questions: [
        {
          id: "1",
          question: "Why scheduler?",
          evidenceExcerpt: "- Added scheduler module",
          whyAsked: "Git cannot establish prod use",
          sourceGroupId: finishId,
        },
      ],
      schemaVersion: PIPELINE_PROVENANCE_VERSION,
    });

    const ctx = {
      repoPath: tmpDir,
      dataRoot: tmpDir,
      groupsDir: path.join(tmpDir, "groups"),
      reportsDir: path.join(tmpDir, "reports"),
      preparedDir: path.join(tmpDir, "prepared"),
      finishDir,
      summariesDir: path.join(tmpDir, "summaries"),
      dryRun: false,
      backup: false,
    };

    migrateFile(finishPath, ctx);
    const migrated = JSON.parse(fs.readFileSync(finishPath, "utf8")) as {
      questionsAnalyses: { question: string[] }[];
      schemaVersion: number;
    };
    expect(migrated.schemaVersion).toBe(FINISH_QUESTIONS_ANALYSES_VERSION);
    expect(migrated.questionsAnalyses[0]?.question).toEqual(["Why scheduler?"]);
  });
});
