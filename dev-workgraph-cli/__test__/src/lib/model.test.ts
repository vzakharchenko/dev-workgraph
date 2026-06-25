import { describe, expect, it } from "vitest";
import { parseAndValidateModelJson } from "../../../src/lib/json-response.js";
import {
  enforceSignalReasons,
  groupClassifyJsonSchema,
  groupHistoryJsonSchema,
  maxSignal,
  mergeTechnologies,
  modelJsonSchema,
  prepareQuestionsJsonSchema,
  prepareReasonsJsonSchema,
  prepareTechnologiesJsonSchema,
  projectProfileJsonSchema,
  reportHistoryJsonSchema,
  reportMergeJsonSchema,
  reportNewHistoryJsonSchema,
  roleNarrativeJsonSchema,
  routineCheckJsonSchema,
  storyPrepareJsonSchema,
} from "../../../src/lib/model.js";
import { sampleModel } from "../../helpers.js";

const validCommitJson = JSON.stringify({
  summary: "Added handler",
  changeTypes: ["feature"],
  technologies: ["TypeScript"],
  technicalSignal: "medium",
  architectureSignal: "low",
  securitySignal: "low",
  signalReasons: { technical: "new module", architecture: "", security: "" },
  questionsAnalysis: [],
  confidence: "medium",
});

describe("maxSignal", () => {
  it("returns the higher signal on the low < medium < high scale", () => {
    expect(maxSignal("low", "high")).toBe("high");
    expect(maxSignal("medium", "low")).toBe("medium");
    expect(maxSignal("high", "high")).toBe("high");
  });
});

describe("mergeTechnologies", () => {
  it("dedupes case-insensitively while preserving first casing", () => {
    expect(mergeTechnologies(["Node.js"], ["node.js"], ["TypeScript"])).toEqual([
      "Node.js",
      "TypeScript",
    ]);
  });

  it("skips empty strings", () => {
    expect(mergeTechnologies(["  ", "Go"], undefined)).toEqual(["Go"]);
  });
});

describe("enforceSignalReasons", () => {
  it("demotes non-low signals without a reason to low", () => {
    const fixed = enforceSignalReasons(
      sampleModel({
        technicalSignal: "high",
        architectureSignal: "medium",
        signalReasons: { technical: "  ", architecture: "ok", security: "" },
      }),
    );
    expect(fixed.technicalSignal).toBe("low");
    expect(fixed.architectureSignal).toBe("medium");
  });
});

describe("json schemas", () => {
  it("modelJsonSchema validates commit output", () => {
    expect(parseAndValidateModelJson(validCommitJson, modelJsonSchema())).toMatchObject({
      summary: "Added handler",
    });
  });

  it("groupClassifyJsonSchema requires context tiers", () => {
    const parsed = parseAndValidateModelJson(
      JSON.stringify({
        changeTypes: ["feature"],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: { technical: "x", architecture: "", security: "" },
        questionsAnalyses: [],
        confidence: "medium",
        hiContext: ["Core"],
        mediumContext: [],
        lowContext: [],
      }),
      groupClassifyJsonSchema(),
    ) as { hiContext: string[] };
    expect(parsed.hiContext).toEqual(["Core"]);
  });

  it("groupHistoryJsonSchema accepts history string", () => {
    expect(
      parseAndValidateModelJson('{"history":"Did work."}', groupHistoryJsonSchema()),
    ).toEqual({ history: "Did work." });
  });

  it("reportMergeJsonSchema accepts merged arrays", () => {
    const parsed = parseAndValidateModelJson(
      JSON.stringify({
        changeTypes: ["feature"],
        signalReasons: { technical: ["t"], architecture: [], security: [] },
        questionsAnalyses: [],
        confidence: "medium",
        hiContext: [],
        mediumContext: [],
        lowContext: [],
      }),
      reportMergeJsonSchema(),
    );
    expect(parsed).toBeTruthy();
  });

  it("storyPrepareJsonSchema accepts preparedContext", () => {
    expect(
      parseAndValidateModelJson('{"preparedContext":"I led the migration."}', storyPrepareJsonSchema()),
    ).toEqual({ preparedContext: "I led the migration." });
  });

  it("projectProfileJsonSchema accepts profile fields", () => {
    expect(
      parseAndValidateModelJson(
        JSON.stringify({
          summary: "CLI",
          domains: ["tooling"],
          apparentStack: ["TypeScript"],
          keyThemes: ["git"],
        }),
        projectProfileJsonSchema(),
      ),
    ).toMatchObject({ summary: "CLI" });
  });

  it("roleNarrativeJsonSchema accepts narrative array", () => {
    expect(
      parseAndValidateModelJson('{"narrative":["Impact one","Impact two"]}', roleNarrativeJsonSchema()),
    ).toEqual({ narrative: ["Impact one", "Impact two"] });
  });

  it("prepareTechnologiesJsonSchema accepts technologies array", () => {
    expect(
      parseAndValidateModelJson('{"technologies":["TypeScript"]}', prepareTechnologiesJsonSchema()),
    ).toEqual({ technologies: ["TypeScript"] });
  });

  it("prepareReasonsJsonSchema accepts four reasons", () => {
    expect(
      parseAndValidateModelJson(
        '{"signalReasons":["a","b","c","d"]}',
        prepareReasonsJsonSchema(),
      ),
    ).toEqual({ signalReasons: ["a", "b", "c", "d"] });
  });

  it("prepareQuestionsJsonSchema accepts questionsAnalyses and confidence", () => {
    expect(
      parseAndValidateModelJson(
        '{"questionsAnalyses":[{"observation":["o"],"missingPiece":["m"],"question":["q1"]}],"confidence":"medium"}',
        prepareQuestionsJsonSchema(),
      ),
    ).toMatchObject({ confidence: "medium" });
  });

  it("routineCheckJsonSchema accepts routine flag", () => {
    expect(
      parseAndValidateModelJson('{"routine": true, "reason": "deps only"}', routineCheckJsonSchema()),
    ).toMatchObject({ routine: true });
  });

  it("reportHistoryJsonSchema accepts history strings", () => {
    expect(
      parseAndValidateModelJson('{"history":["entry one"]}', reportHistoryJsonSchema()),
    ).toEqual({ history: ["entry one"] });
  });

  it("reportNewHistoryJsonSchema accepts needed + text only", () => {
    expect(
      parseAndValidateModelJson('{"needed": true, "text": "Added deploy scripts."}', reportNewHistoryJsonSchema()),
    ).toMatchObject({ needed: true });
  });

  it("modelJsonSchema rejects invalid enum values", () => {
    expect(() =>
      parseAndValidateModelJson(
        validCommitJson.replace('"medium"', '"extreme"'),
        modelJsonSchema(),
      ),
    ).toThrow(/invalid enum/i);
  });
});
