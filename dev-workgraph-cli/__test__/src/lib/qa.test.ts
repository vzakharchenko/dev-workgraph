import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureQaIds,
  maxQaIdNumber,
  newQaPairs,
  readAnswersFile,
} from "../../../src/lib/qa.js";

const provenance = {
  sourceFinal: "1700000000.json",
  sourceReport: "1700000000.json",
};

describe("qa ids", () => {
  it("assigns q1..qN and provenance to legacy pairs", () => {
    expect(
      ensureQaIds(
        [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ],
        provenance,
      ),
    ).toEqual([
      { id: "q1", question: "Q1", answer: "A1", ...provenance },
      { id: "q2", question: "Q2", answer: "A2", ...provenance },
    ]);
  });

  it("preserves existing ids and provenance when deepening", () => {
    const prior = ensureQaIds(
      [
        {
          id: "q1",
          question: "Q1",
          answer: "A1",
          sourceFinal: "1700000000.json",
          sourceReport: "1700000000.json",
        },
        {
          id: "q2",
          question: "Q2",
          answer: "A2",
          sourceFinal: "1700000000.json",
          sourceReport: "1700000000.json",
        },
      ],
      provenance,
    );
    const added = newQaPairs(
      [
        { question: "Q3", answer: "A3" },
        { question: "Q4", answer: "A4" },
      ],
      prior,
      { sourceFinal: "1700000000.v2.json", sourceReport: "1700000000.json" },
    );
    expect(added.map((p) => p.id)).toEqual(["q3", "q4"]);
    expect(added[0]?.sourceFinal).toBe("1700000000.v2.json");
    expect(prior[0]?.sourceFinal).toBe("1700000000.json");
  });

  it("continues numbering from prior finish when reading an answers file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-qa-"));
    const file = path.join(tmp, "answers.json");
    fs.writeFileSync(file, JSON.stringify([{ question: "New?", answer: "Yes." }]));
    const prior = ensureQaIds(
      [
        {
          id: "q1",
          question: "Old?",
          answer: "No.",
          sourceFinal: "1700000000.json",
          sourceReport: "1700000000.json",
        },
      ],
      provenance,
    );
    expect(
      readAnswersFile(file, ["fallback"], prior, {
        sourceFinal: "1700000000.v2.json",
        sourceReport: "1700000000.json",
      }),
    ).toEqual([
      {
        id: "q2",
        question: "New?",
        answer: "Yes.",
        sourceFinal: "1700000000.v2.json",
        sourceReport: "1700000000.json",
      },
    ]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("maxQaIdNumber tracks the highest qN suffix", () => {
    expect(maxQaIdNumber([{ id: "q1" }, { id: "q12" }])).toBe(12);
    expect(maxQaIdNumber([])).toBe(0);
  });
});
