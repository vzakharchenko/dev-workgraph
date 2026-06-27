import { describe, expect, it } from "vitest";
import { stampSchemaVersion } from "../../../src/lib/record-io.js";
import { encodeSemver } from "../../../src/lib/semver-version.js";
import { VERSION } from "../../../src/lib/version.js";

describe("encodeSemver", () => {
  it("encodes major.minor.patch as major·10⁶ + minor·10³ + patch", () => {
    expect(encodeSemver("1.0.0")).toBe(1_000_000);
    expect(encodeSemver("1.2.3")).toBe(1_002_003);
    expect(encodeSemver("2.10.99")).toBe(2_010_099);
  });

  it("rejects invalid semver", () => {
    expect(() => encodeSemver("not-a-version")).toThrow(/invalid semver/i);
  });
});

describe("stampSchemaVersion", () => {
  it("adds schemaVersion from VERSION", () => {
    expect(stampSchemaVersion({ reportId: 1 }).schemaVersion).toBe(VERSION);
  });

  it("does not change finish-chain version on finish archives", () => {
    const stamped = stampSchemaVersion({
      finishId: 1,
      sourcePrepared: "1.json",
      sourceReport: "1.json",
      project: "p",
      role: "Dev",
      technologies: [],
      history: "h",
      narrative: [],
      answers: [],
      outputMarkdown: "1.md",
      version: 2,
      provenance: { model: "m", generatedAt: "t" },
    });
    expect(stamped.version).toBe(2);
    expect(stamped.schemaVersion).toBe(VERSION);
  });
});
