// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeMigrationJson, testMigrationContext } from "../helpers/migration-fixtures.js";
import { migrateFile } from "../../../src/lib/migrations/index.js";
import { FINISH_QUESTIONS_ANALYSES_VERSION } from "../../../src/lib/migrations/steps/v1000006-finish-questions-analyses.js";
import { PIPELINE_PROVENANCE_VERSION } from "../../../src/lib/migrations/steps/v1000005-pipeline-provenance.js";

describe("finish questions analyses migration v1000006", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

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

    writeMigrationJson(path.join(preparedDir, `${preparedId}.json`), {
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

    const ctx = testMigrationContext(tmpDir);

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
    writeMigrationJson(finishPath, {
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

    const ctx = testMigrationContext(tmpDir);

    migrateFile(finishPath, ctx);
    const migrated = JSON.parse(fs.readFileSync(finishPath, "utf8")) as {
      questionsAnalyses: { question: string[] }[];
      schemaVersion: number;
    };
    expect(migrated.schemaVersion).toBe(FINISH_QUESTIONS_ANALYSES_VERSION);
    expect(migrated.questionsAnalyses[0]?.question).toEqual(["Why scheduler?"]);
  });
});
