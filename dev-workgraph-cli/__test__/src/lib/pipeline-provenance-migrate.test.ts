// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrateFinishQuestionsRecord,
  migrateFinishRecord,
  migrateGroupRecord,
  migratePreparedRecord,
  migrateReportRecord,
} from "../../../src/lib/migrations/steps/pipeline-provenance-migrate.js";
import type { MigrationContext } from "../../../src/lib/migrations/types.js";
import { emptyDeterministic, sampleGroup, sampleModel, sampleReport } from "../../helpers.js";

describe("pipeline-provenance-migrate", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function ctx(overrides: Partial<MigrationContext> = {}): MigrationContext {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-prov-migrate-"));
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

  function writeJson(filePath: string, record: object): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  it("migrateGroupRecord wraps legacy string reasons and attaches thread ids", () => {
    const migrationCtx = ctx();
    const groupId = 1_700_000_000;
    const summaryRel = "summaries/100/abc.json";
    writeJson(path.join(migrationCtx.dataRoot, summaryRel), {
      commitHash: "abc",
      timestamp: 100,
      sourceEvidence: "100",
      model: sampleModel({
        signalReasons: { technical: "Auth refactor", architecture: "", security: "" },
      }),
    });

    const group = sampleGroup({
      timestampEnd: groupId,
      groups: {
        commits: ["abc"],
        tiers: { hi: ["abc"], medium: [], low: [] },
        sourceEvidence: ["100"],
        sourceSummaries: [summaryRel],
      },
      model: {
        ...sampleGroup().model!,
        signalReasons: { technical: "Auth refactor", architecture: "", security: "" },
        questionsAnalyses: [
          {
            observation: ["Auth refactor in module"],
            missingPiece: ["Production unknown"],
            question: ["Shipped to prod?"],
          },
        ],
      },
    });

    const migrated = migrateGroupRecord(group, migrationCtx);
    const tech = migrated.model?.signalReasons.technical as {
      text: string;
      sourceGroupIds: number[];
      sourceCommits?: string[];
    };
    expect(tech.text).toBe("Auth refactor");
    expect(tech.sourceGroupIds).toEqual([groupId]);
    expect(tech.sourceCommits).toEqual(["abc"]);
    expect(migrated.model?.questionsAnalyses[0]?.threadId).toBeDefined();
    expect(migrated.model?.questionsAnalyses[0]?.sourceGroupIds).toContain(groupId);
  });

  it("migrateReportRecord replays signal reasons from source groups", () => {
    const migrationCtx = ctx();
    const g1 = 1_700_000_000;
    const g2 = 1_700_086_400;
    writeJson(path.join(migrationCtx.groupsDir, `${g1}.json`), {
      ...sampleGroup({ timestampEnd: g1 }),
      model: {
        ...sampleGroup().model!,
        signalReasons: { technical: "First group technical work", architecture: "", security: "" },
      },
    });
    writeJson(path.join(migrationCtx.groupsDir, `${g2}.json`), {
      ...sampleGroup({ timestampEnd: g2 }),
      model: {
        ...sampleGroup().model!,
        signalReasons: {
          technical: "First group technical work extended",
          architecture: "Boundary change",
          security: "",
        },
      },
    });

    const report = sampleReport({
      reportId: g2,
      sourceGroups: [`${g1}.json`, `${g2}.json`],
      model: {
        ...sampleReport().model,
        signalReasons: { technical: ["stale inline"], architecture: [], security: [] },
        questionsAnalyses: [
          {
            observation: ["thread"],
            missingPiece: ["gap"],
            question: ["q?"],
          },
        ],
      },
    });

    const migrated = migrateReportRecord(report, migrationCtx);
    const technical = migrated.model.signalReasons.technical as {
      text: string;
      sourceGroupIds: number[];
    }[];
    expect(technical.length).toBeGreaterThan(0);
    expect(
      technical.some((e) => e.sourceGroupIds.includes(g1) || e.sourceGroupIds.includes(g2)),
    ).toBe(true);
    expect(migrated.model.questionsAnalyses[0]?.threadId).toBeDefined();
  });

  it("migrateReportRecord unions group ids for multi-source question threads", () => {
    const migrationCtx = ctx();
    const g1 = 1_700_000_100;
    const g2 = 1_700_000_200;
    writeJson(path.join(migrationCtx.groupsDir, `${g1}.json`), sampleGroup({ timestampEnd: g1 }));
    writeJson(path.join(migrationCtx.groupsDir, `${g2}.json`), sampleGroup({ timestampEnd: g2 }));
    const report = sampleReport({
      reportId: g2,
      sourceGroups: [`${g1}.json`, `${g2}.json`],
      model: {
        ...sampleReport().model,
        questionsAnalyses: [
          {
            observation: ["obs"],
            missingPiece: ["gap"],
            question: ["question?"],
          },
        ],
      },
    });
    const migrated = migrateReportRecord(report, migrationCtx);
    expect(migrated.model.questionsAnalyses[0]?.sourceGroupIds).toEqual(
      expect.arrayContaining([g1, g2]),
    );
  });

  it("migrateReportRecord seeds provenance for single-source reports", () => {
    const migrationCtx = ctx();
    const groupId = 1_700_000_000;
    writeJson(path.join(migrationCtx.groupsDir, `${groupId}.json`), {
      ...sampleGroup({ timestampEnd: groupId }),
    });
    const report = sampleReport({
      reportId: groupId,
      sourceGroups: [`${groupId}.json`],
      model: {
        ...sampleReport().model,
        questionsAnalyses: [
          {
            observation: ["obs"],
            missingPiece: ["gap"],
            question: ["question?"],
          },
        ],
      },
    });
    const migrated = migrateReportRecord(report, migrationCtx);
    expect(migrated.model.questionsAnalyses[0]?.sourceGroupIds).toEqual([groupId]);
  });

  it("migratePreparedRecord normalizes signal reasons to four slots", () => {
    const migrationCtx = ctx();
    const prepared = {
      preparedId: 1,
      sourceReport: "1.json",
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "low" as const,
        architectureSignal: "low" as const,
        securitySignal: "low" as const,
        signalReasons: ["one", "two"],
        questionsAnalyses: [],
        confidence: "low" as const,
        history: "",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: "1.json" },
      },
      schemaVersion: 1_000_005,
    };
    const migrated = migratePreparedRecord(prepared, migrationCtx);
    expect(migrated.model.signalReasons).toHaveLength(4);
  });

  it("migrateFinishQuestionsRecord copies lineage from prepared when present", () => {
    const migrationCtx = ctx();
    const preparedId = 1_700_000_000;
    writeJson(path.join(migrationCtx.reportsDir, `${preparedId}.json`), {
      reportId: preparedId,
      sourceGroups: [`${preparedId}.json`],
      groupCount: 1,
      deterministic: { ...emptyDeterministic(), historySource: [[`${preparedId}.json`]] },
      model: {
        ...sampleReport().model,
        questionsAnalyses: [
          {
            threadId: "1700000000000000",
            observation: ["obs"],
            missingPiece: ["gap"],
            question: ["q?"],
            sourceGroupIds: [preparedId],
            lineageKind: "signal-reason",
            derivedFromSignalReasonIndex: 0,
          },
        ],
      },
      history: [{ text: "work" }],
    });
    writeJson(path.join(migrationCtx.preparedDir, `${preparedId}.json`), {
      preparedId,
      sourceReport: `${preparedId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium" as const,
        architectureSignal: "low" as const,
        securitySignal: "low" as const,
        signalReasons: [{ text: "reason", sourceGroupIds: [preparedId], sourceCommits: [] }],
        questionsAnalyses: [
          {
            threadId: "1700000000000000",
            observation: ["obs"],
            missingPiece: ["gap"],
            question: ["q?"],
            sourceGroupIds: [preparedId],
            lineageKind: "signal-reason",
            derivedFromSignalReasonIndex: 0,
          },
        ],
        confidence: "medium" as const,
        history: "work",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${preparedId}.json` },
      },
      schemaVersion: 1_000_006,
    });

    const finish = migrateFinishQuestionsRecord(
      {
        sourceFinal: `${preparedId}.json`,
        sourceReport: `${preparedId}.json`,
        questions: [
          {
            id: "1",
            question: "q?",
            threadIndex: 0,
          },
        ],
        questionsAnalyses: [],
        schemaVersion: 1_000_006,
      },
      migrationCtx,
    );
    expect(finish.questions[0]?.sourceGroupIds).toContain(preparedId);
    expect(finish.questions[0]?.lineageKind).toBe("signal-reason");
    expect(finish.questionsAnalyses?.[0]?.sourceGroupIds).toContain(preparedId);
  });

  it("migrateFinishRecord is a no-op", () => {
    const record = {
      finishId: 1,
      sourcePrepared: "1.json",
      sourceQuestions: ["1.question.json"],
      model: { narrative: "n", impact: "i", cvBullets: [], provenance: { model: "t", generatedAt: "x" } },
      schemaVersion: 1,
    };
    expect(migrateFinishRecord(record)).toBe(record);
  });
});
