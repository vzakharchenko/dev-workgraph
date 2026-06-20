import { describe, expect, it } from "vitest";
import { emptyDeterministic, sampleCommit, sampleModel, sampleReport } from "../helpers.js";

describe("record fixtures", () => {
  it("builds a commit record with deterministic and optional model layers", () => {
    const commit = sampleCommit({
      commitHash: "abc123",
      model: sampleModel({ summary: "feature work" }),
    });
    expect(commit.commitHash).toBe("abc123");
    expect(commit.model?.summary).toBe("feature work");
    expect(commit.deterministic.linesAdded).toBe(0);
  });

  it("builds a report with root sourceGroups and parallel historySource", () => {
    const report = sampleReport();
    expect(report.sourceGroups).toEqual(["1000.json"]);
    expect(report.deterministic.historySource).toEqual([["1000.json"]]);
    expect(report.history).toEqual([{ text: "did work" }]);
  });

  it("allows deterministic overrides through the helper", () => {
    const layer = emptyDeterministic({ linesAdded: 42, areas: ["backend"] });
    expect(layer.linesAdded).toBe(42);
    expect(layer.areas).toEqual(["backend"]);
  });
});
