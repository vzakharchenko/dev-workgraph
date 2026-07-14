// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyPreparedQuestionAnalyses } from "../../../src/lib/legacy-prepared.js";
import {
  repairFinishQuestionsRecordLineage,
  repairPreparedRecordQuestionLineage,
  repairQuestionLineageArtifact,
} from "../../../src/lib/repair-question-lineage.js";
import type { MigrationContext } from "../../../src/lib/migrations/types.js";
import { sampleReport } from "../../helpers.js";

describe("repair-question-lineage", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function ctx(): MigrationContext {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wg-repair-lineage-"));
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
    };
  }

  function writeJson(filePath: string, record: object): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  it("repairPreparedRecordQuestionLineage is a no-op when lineage is complete", () => {
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
        signalReasons: [],
        questionsAnalyses: [
          {
            threadId: "1000000000000000",
            observation: ["o"],
            missingPiece: ["m"],
            question: ["q"],
            sourceGroupIds: [1],
          },
        ],
        confidence: "low" as const,
        history: "",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: "1.json" },
      },
      schemaVersion: 1_000_006,
    };
    expect(repairPreparedRecordQuestionLineage(prepared, migrationCtx)).toBe(prepared);
  });

  it("repairPreparedRecordQuestionLineage fills lineage from report signal refs", () => {
    const migrationCtx = ctx();
    const reportId = 1_700_000_000;
    writeJson(path.join(migrationCtx.reportsDir, `${reportId}.json`), {
      ...sampleReport({
        reportId,
        model: {
          ...sampleReport().model,
          signalReasons: {
            technical: [{ text: "Iterator export", sourceGroupIds: [reportId], sourceCommits: ["abc"] }],
            architecture: [],
            security: [],
          },
          questionsAnalyses: [],
        },
      }),
    });

    const prepared = {
      preparedId: reportId,
      sourceReport: `${reportId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "medium" as const,
        architectureSignal: "low" as const,
        securitySignal: "low" as const,
        signalReasons: [{ text: "Iterator export", sourceGroupIds: [reportId], sourceCommits: [] }],
        questionsAnalyses: [
          {
            observation: ["IteratorFactory added"],
            missingPiece: ["Why Iterator"],
            question: ["Why Iterator pattern?"],
            derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
            derivedFromPreparedSignalSlots: [0],
          },
        ],
        confidence: "medium" as const,
        history: "",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${reportId}.json` },
      },
      schemaVersion: 1_000_005,
    };

    const repaired = repairPreparedRecordQuestionLineage(prepared, migrationCtx);
    const repairedAnalyses = legacyPreparedQuestionAnalyses(repaired);
    expect(repairedAnalyses[0]?.lineageKind).toBe("signal-reason");
    expect(repairedAnalyses[0]?.sourceGroupIds).toContain(reportId);
    expect(repairedAnalyses[0]?.sourceCommits).toContain("abc");
    expect(repaired.model.signalReasons).toHaveLength(4);
  });

  it("repairFinishQuestionsRecordLineage syncs question cards from analyses", () => {
    const migrationCtx = ctx();
    const reportId = 1_700_000_000;
    writeJson(path.join(migrationCtx.reportsDir, `${reportId}.json`), {
      ...sampleReport({
        reportId,
        model: {
          ...sampleReport().model,
          signalReasons: {
            technical: [{ text: "Auth change", sourceGroupIds: [reportId], sourceCommits: [] }],
            architecture: [],
            security: [],
          },
        },
      }),
    });

    const record = {
      sourceFinal: `${reportId}.json`,
      sourceReport: `${reportId}.json`,
      questions: [{ id: "1", question: "Why auth?", threadIndex: 0 }],
      questionsAnalyses: [
        {
          observation: ["Auth module"],
          missingPiece: ["Intent"],
          question: ["Why auth?"],
          derivedFromReportSignalRefs: [{ dimension: "technical", index: 0 }],
          derivedFromPreparedSignalSlots: [0],
        },
      ],
      schemaVersion: 1_000_006,
    };

    const repaired = repairFinishQuestionsRecordLineage(record, migrationCtx);
    expect(repaired.questions[0]?.lineageKind).toBe("signal-reason");
    expect(repaired.questions[0]?.sourceGroupIds).toContain(reportId);
  });

  it("repairQuestionLineageArtifact copies prepared analyses onto finish file", () => {
    const migrationCtx = ctx();
    const preparedId = 1_700_000_000;
    writeJson(path.join(migrationCtx.preparedDir, `${preparedId}.json`), {
      preparedId,
      sourceReport: `${preparedId}.json`,
      groupCount: 1,
      model: {
        changeTypes: [],
        technologies: [],
        technicalSignal: "low" as const,
        architectureSignal: "low" as const,
        securitySignal: "low" as const,
        signalReasons: [],
        questionsAnalyses: [
          {
            threadId: "1700000000000000",
            observation: ["obs"],
            missingPiece: ["gap"],
            question: ["q?"],
            sourceGroupIds: [preparedId],
          },
        ],
        confidence: "low" as const,
        history: "",
        provenance: { model: "t", generatedAt: "2026-01-01", sourceReport: `${preparedId}.json` },
      },
      schemaVersion: 1_000_005,
    });

    const finishPath = path.join(migrationCtx.finishDir, `${preparedId}.question.json`);
    writeJson(finishPath, {
      sourceFinal: `${preparedId}.json`,
      sourceReport: `${preparedId}.json`,
      questions: [{ id: "1", question: "q?", threadIndex: 0 }],
      schemaVersion: 1_000_005,
    });

    const changed = repairQuestionLineageArtifact(finishPath, "finish-questions", migrationCtx);
    expect(changed).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(finishPath, "utf8")) as {
      questionsAnalyses: { sourceGroupIds: number[] }[];
      questions: { sourceGroupIds: number[] }[];
    };
    expect(onDisk.questionsAnalyses[0]?.sourceGroupIds).toContain(preparedId);
    expect(onDisk.questions[0]?.sourceGroupIds).toContain(preparedId);
  });

  it("repairQuestionLineageArtifact returns false for unsupported kinds", () => {
    const migrationCtx = ctx();
    expect(repairQuestionLineageArtifact("/tmp/group.json", "group", migrationCtx)).toBe(false);
  });
});
