import { describe, expect, it } from "vitest";
import { mergePartSummaries, mergeSignalReason } from "../../../src/lib/merge-commit-summary.js";
import type { ModelLayer } from "../../../src/lib/model.js";

function partLayer(overrides: Partial<ModelLayer>): ModelLayer {
  return {
    summary: "",
    changeTypes: [],
    technologies: [],
    technicalSignal: "low",
    architectureSignal: "low",
    securitySignal: "low",
    signalReasons: { technical: "", architecture: "", security: "" },
    questionsAnalysis: [],
    confidence: "low",
    ...overrides,
  };
}

describe("mergeSignalReason", () => {
  const dim = "technical" as const;

  it("low then medium keeps only medium reason", () => {
    const parts = [
      partLayer({ technicalSignal: "low", signalReasons: { technical: "E", architecture: "", security: "" } }),
      partLayer({ technicalSignal: "medium", signalReasons: { technical: "F", architecture: "", security: "" } }),
    ];
    expect(mergeSignalReason(parts, dim)).toBe("F");
  });

  it("medium then medium joins with period", () => {
    const parts = [
      partLayer({ technicalSignal: "medium", signalReasons: { technical: "F", architecture: "", security: "" } }),
      partLayer({ technicalSignal: "medium", signalReasons: { technical: "E", architecture: "", security: "" } }),
    ];
    expect(mergeSignalReason(parts, dim)).toBe("F. E");
  });

  it("medium then high resets to high only", () => {
    const parts = [
      partLayer({ technicalSignal: "medium", signalReasons: { technical: "E", architecture: "", security: "" } }),
      partLayer({ technicalSignal: "high", signalReasons: { technical: "H", architecture: "", security: "" } }),
    ];
    expect(mergeSignalReason(parts, dim)).toBe("H");
  });

  it("high then high joins with comma", () => {
    const parts = [
      partLayer({ technicalSignal: "high", signalReasons: { technical: "H", architecture: "", security: "" } }),
      partLayer({ technicalSignal: "high", signalReasons: { technical: "I", architecture: "", security: "" } }),
    ];
    expect(mergeSignalReason(parts, dim)).toBe("H, I");
  });
});

describe("mergePartSummaries", () => {
  it("joins summaries with a period", () => {
    const merged = mergePartSummaries([
      partLayer({ summary: "Part one" }),
      partLayer({ summary: "Part two" }),
    ]);
    expect(merged.summary).toBe("Part one. Part two");
  });

  it("unions changeTypes and technologies", () => {
    const merged = mergePartSummaries([
      partLayer({ changeTypes: ["feature"], technologies: ["TypeScript"] }),
      partLayer({ changeTypes: ["bugfix", "feature"], technologies: ["typescript", "Node.js"] }),
    ]);
    expect(merged.changeTypes).toEqual(["feature", "bugfix"]);
    expect(merged.technologies).toEqual(["TypeScript", "Node.js"]);
  });

  it("concatenates questionsAnalysis", () => {
    const merged = mergePartSummaries([
      partLayer({
        questionsAnalysis: [
          { observation: "o1", missingPiece: "m1", question: "q1" },
        ],
      }),
      partLayer({
        questionsAnalysis: [
          { observation: "o2", missingPiece: "m2", question: "q2" },
        ],
      }),
    ]);
    expect(merged.questionsAnalysis).toHaveLength(2);
    expect(merged.questionsAnalysis[0]!.question).toBe("q1");
    expect(merged.questionsAnalysis[1]!.question).toBe("q2");
  });

  it("takes max confidence and signals", () => {
    const merged = mergePartSummaries([
      partLayer({
        technicalSignal: "low",
        architectureSignal: "medium",
        securitySignal: "high",
        confidence: "medium",
        signalReasons: { technical: "t-low", architecture: "a-med", security: "s-high" },
      }),
      partLayer({
        technicalSignal: "high",
        architectureSignal: "low",
        securitySignal: "medium",
        confidence: "high",
        signalReasons: { technical: "t-high", architecture: "a-low", security: "s-med" },
      }),
    ]);
    expect(merged.technicalSignal).toBe("high");
    expect(merged.architectureSignal).toBe("medium");
    expect(merged.securitySignal).toBe("high");
    expect(merged.confidence).toBe("high");
  });
});
