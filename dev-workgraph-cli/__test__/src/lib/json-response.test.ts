import { describe, expect, it } from "vitest";
import { parseAndValidateModelJson } from "../../../src/lib/json-response.js";
import { routineCheckJsonSchema } from "../../../src/lib/model.js";

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

  it("rejects syntactically invalid JSON inside a balanced object", () => {
    expect(() => parseAndValidateModelJson('{"routine": true, broken}', schema)).toThrow(
      /invalid JSON from model/i,
    );
  });

  it("validates nested object and array properties", () => {
    const nestedSchema = {
      type: "object",
      required: ["meta", "tags"],
      properties: {
        meta: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        tags: { type: "array", items: { type: "string" } },
      },
    };
    const result = parseAndValidateModelJson(
      '{"meta": {"name": "report"}, "tags": ["a", "b"]}',
      nestedSchema,
    ) as { meta: { name: string }; tags: string[] };
    expect(result.meta.name).toBe("report");
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("rejects non-object values where an object is expected", () => {
    const nestedSchema = {
      type: "object",
      required: ["meta"],
      properties: { meta: { type: "object", properties: {} } },
    };
    expect(() => parseAndValidateModelJson('{"meta": []}', nestedSchema)).toThrow(
      /expected object at root\.meta/i,
    );
  });

  it("rejects non-array values where an array is expected", () => {
    const arraySchema = {
      type: "object",
      required: ["tags"],
      properties: { tags: { type: "array", items: { type: "string" } } },
    };
    expect(() => parseAndValidateModelJson('{"tags": "nope"}', arraySchema)).toThrow(
      /expected array at root\.tags/i,
    );
  });

  it("rejects enum values outside the allowed set", () => {
    const enumSchema = {
      type: "object",
      required: ["level"],
      properties: { level: { type: "string", enum: ["low", "high"] } },
    };
    expect(() => parseAndValidateModelJson('{"level": "medium"}', enumSchema)).toThrow(
      /invalid enum at root\.level/i,
    );
  });

  it("rejects non-string values where a string is expected", () => {
    const stringSchema = {
      type: "object",
      required: ["label"],
      properties: { label: { type: "string" } },
    };
    expect(() => parseAndValidateModelJson('{"label": 42}', stringSchema)).toThrow(
      /expected string at root\.label/i,
    );
  });
});
