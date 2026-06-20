import { describe, expect, it } from "vitest";
import { parseAndValidateModelJson } from "../../src/lib/json-response.js";
import { routineCheckJsonSchema } from "../../src/lib/model.js";

describe("parseAndValidateModelJson", () => {
  const schema = routineCheckJsonSchema();

  it("parses fenced JSON and validates against schema", () => {
    const result = parseAndValidateModelJson(
      'Here you go:\n```json\n{"routine": true, "reason": "deps only"}\n```',
      schema,
    ) as { routine: boolean; reason: string };
    expect(result.routine).toBe(true);
    expect(result.reason).toBe("deps only");
  });

  it("parses fences without json language tag", () => {
    const result = parseAndValidateModelJson(
      '```\n{"routine": false, "reason": "feature"}\n```',
      schema,
    ) as { routine: boolean };
    expect(result.routine).toBe(false);
  });

  it("extracts the first balanced object from prose", () => {
    const result = parseAndValidateModelJson(
      'Note {"routine": false, "reason": "feature work"} trailing',
      schema,
    ) as { routine: boolean };
    expect(result.routine).toBe(false);
  });

  it("handles escaped quotes inside strings", () => {
    const result = parseAndValidateModelJson(
      '{"routine": false, "reason": "fixed \\"edge\\" case"}',
      schema,
    ) as { reason: string };
    expect(result.reason).toBe('fixed "edge" case');
  });

  it("rejects invalid JSON", () => {
    expect(() => parseAndValidateModelJson('{"routine":', schema)).toThrow(
      /invalid JSON|unclosed JSON/i,
    );
  });

  it("rejects schema violations", () => {
    expect(() => parseAndValidateModelJson('{"routine": "yes"}', schema)).toThrow(
      /expected boolean/i,
    );
  });

  it("rejects missing required fields", () => {
    expect(() => parseAndValidateModelJson("{}", schema)).toThrow(/missing required field/i);
  });

  it("rejects empty content", () => {
    expect(() => parseAndValidateModelJson("   ", schema)).toThrow(/empty model content/i);
  });

  it("rejects content without a JSON object", () => {
    expect(() => parseAndValidateModelJson("just prose", schema)).toThrow(/no JSON object/i);
  });
});
