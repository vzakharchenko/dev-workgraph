import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finishQuestionsJsonFileName } from "../../../src/lib/finish-load.js";
import {
  allQuestionsAnswered,
  createFinishQuestions,
  loadQuestionCatalog,
  normalizeFinishAnswers,
  questionsNotYetAnswered,
  resolveAnswersToQa,
  resolveFinishQa,
  writeFinishQuestions,
} from "../../../src/lib/finish-questions.js";
import type { FinishRecord } from "../../../src/lib/records.js";

describe("finish-questions", () => {
  it("creates questions with unique timestamp ids and analyses", () => {
    const analyses = [
      { observation: ["o1"], missingPiece: ["m1"], question: ["Q1"] },
      { observation: ["o2"], missingPiece: ["m2"], question: ["Q2"] },
    ];
    const record = createFinishQuestions(
      ["Q1", "Q2"],
      {
        sourceFinal: "1700000000.json",
        sourceReport: "1700000000.json",
      },
      1_700_000_000_000,
      analyses,
    );
    expect(record.questions).toEqual([
      expect.objectContaining({ id: "1700000000000", question: "Q1", threadIndex: 0 }),
      expect.objectContaining({ id: "1700000000001", question: "Q2", threadIndex: 1 }),
    ]);
    expect(record.questionsAnalyses).toEqual(analyses);
  });

  it("names question files like finish archives", () => {
    expect(finishQuestionsJsonFileName(1_700_000_000, 1)).toBe("1700000000.question.json");
    expect(finishQuestionsJsonFileName(1_700_000_000, 2)).toBe("1700000000.question.v2.json");
  });

  it("resolves answers through question files across versions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-questions-"));
    writeFinishQuestions(
      path.join(dir, "1700000000.question.json"),
      createFinishQuestions(
        ["Was it production?"],
        { sourceFinal: "1700000000.json", sourceReport: "1700000000.json" },
        1_700_000_000_000,
      ),
    );
    writeFinishQuestions(
      path.join(dir, "1700000000.question.v2.json"),
      createFinishQuestions(
        ["Was it shipped?"],
        { sourceFinal: "1700000000.v2.json", sourceReport: "1700000000.json" },
        1_700_000_000_100,
      ),
    );
    const qa = resolveAnswersToQa(
      dir,
      1_700_000_000,
      2,
      [
        { questionId: "1700000000000", answer: "Staging only." },
        { questionId: "1700000000100", answer: "Yes." },
      ],
    );
    expect(qa).toEqual([
      { question: "Was it production?", answer: "Staging only." },
      { question: "Was it shipped?", answer: "Yes." },
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("supports legacy inline question answers on finish records", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-legacy-"));
    const record = {
      answers: [{ question: "Old?", answer: "Yes." }],
    } as FinishRecord;
    expect(resolveFinishQa(dir, record, "1700000000.json")).toEqual([
      { question: "Old?", answer: "Yes." },
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects unanswered questions and duplicate question text", () => {
    const questions = createFinishQuestions(["Q1", "Q2"], {
      sourceFinal: "1700000000.json",
      sourceReport: "1700000000.json",
    }, 10).questions;
    expect(allQuestionsAnswered(questions, [{ questionId: questions[0]!.id, answer: "A1" }])).toBe(
      false,
    );
    expect(
      questionsNotYetAnswered(["Q2", "q2"], [{ question: "Q1", answer: "A1" }]),
    ).toEqual(["Q2", "q2"]);
  });

  it("loadQuestionCatalog merges versions 1 through N", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-catalog-"));
    writeFinishQuestions(
      path.join(dir, finishQuestionsJsonFileName(1, 1)),
      createFinishQuestions(["A"], { sourceFinal: "1.json", sourceReport: "r.json" }, 100),
    );
    writeFinishQuestions(
      path.join(dir, finishQuestionsJsonFileName(1, 2)),
      createFinishQuestions(["B"], { sourceFinal: "1.v2.json", sourceReport: "r.json" }, 200),
    );
    const catalog = loadQuestionCatalog(dir, 1, 2);
    expect(catalog.get("100")).toBe("A");
    expect(catalog.get("200")).toBe("B");
    expect(normalizeFinishAnswers([{ question: "legacy", answer: "ok" }])[0]?.questionId).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
