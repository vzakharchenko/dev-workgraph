import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_ENTRIES,
  buildReportDeterministic,
  historyTextsOnly,
  readReportProvenance,
  stripLegacyProvenance,
} from "../../../src/lib/report-provenance.js";
import { emptyDeterministic, sampleReport } from "../../helpers.js";

describe("readReportProvenance", () => {
  it("reads root sourceGroups and parallel historySource", () => {
    const report = sampleReport({
      sourceGroups: ["a.json", "b.json"],
      deterministic: {
        ...emptyDeterministic(),
        historySource: [["a.json"], ["b.json"]],
      },
      history: [{ text: "one" }, { text: "two" }],
    });
    const prov = readReportProvenance(report);
    expect(prov.sourceGroups).toEqual(["a.json", "b.json"]);
    expect(prov.historySources).toEqual([["a.json"], ["b.json"]]);
  });

  it("supports legacy per-entry sourceGroups on history", () => {
    const report = sampleReport({
      sourceGroups: undefined as unknown as string[],
      deterministic: { ...emptyDeterministic(), historySource: [] },
      history: [{ text: "one", sourceGroups: ["legacy.json"] } as { text: string }],
    });
    const prov = readReportProvenance(report);
    expect(prov.historySources).toEqual([["legacy.json"]]);
  });

  it("supports transitional offset historySource layout", () => {
    const report = sampleReport({
      sourceGroups: undefined as unknown as string[],
      deterministic: {
        ...emptyDeterministic(),
        historySource: [["a.json", "b.json"], ["b.json"]],
      },
      history: [{ text: "merged" }],
    });
    const prov = readReportProvenance(report);
    expect(prov.sourceGroups).toEqual(["a.json", "b.json"]);
    expect(prov.historySources).toEqual([["b.json"]]);
  });

  it("reads nested deterministic.sourceGroups in legacy reports", () => {
    const report = sampleReport({
      sourceGroups: undefined as unknown as string[],
      deterministic: {
        ...emptyDeterministic(),
        historySource: [["legacy.json"]],
        sourceGroups: ["legacy.json"],
      } as ReturnType<typeof sampleReport>["deterministic"] & { sourceGroups: string[] },
      history: [{ text: "legacy entry" }],
    });
    const prov = readReportProvenance(report);
    expect(prov.sourceGroups).toEqual(["legacy.json"]);
  });

  it("uses flat historySource when lengths do not match offset layout", () => {
    const report = sampleReport({
      sourceGroups: undefined as unknown as string[],
      deterministic: {
        ...emptyDeterministic(),
        historySource: [["a.json"], ["b.json"]],
      },
      history: [{ text: "one" }, { text: "two" }],
    });
    const prov = readReportProvenance(report);
    expect(prov.sourceGroups).toEqual(["a.json", "b.json"]);
    expect(prov.historySources).toEqual([["a.json"], ["b.json"]]);
  });
});

describe("buildReportDeterministic", () => {
  it("caps historySource rows at MAX_HISTORY_ENTRIES", () => {
    const rows = Array.from({ length: MAX_HISTORY_ENTRIES + 3 }, (_, i) => [`${i}.json`]);
    const built = buildReportDeterministic(emptyDeterministic(), rows);
    expect(built.historySource).toHaveLength(MAX_HISTORY_ENTRIES);
  });

  it("dedupes group files within a row", () => {
    const built = buildReportDeterministic(emptyDeterministic(), [["a.json", "a.json"]]);
    expect(built.historySource[0]).toEqual(["a.json"]);
  });
});

describe("historyTextsOnly", () => {
  it("strips legacy sourceGroups from history entries", () => {
    expect(
      historyTextsOnly([{ text: "work", sourceGroups: ["g.json"] }]),
    ).toEqual([{ text: "work" }]);
  });
});

describe("stripLegacyProvenance", () => {
  it("removes nested deterministic.sourceGroups and history provenance", () => {
    const record = sampleReport({
      deterministic: {
        ...emptyDeterministic(),
        historySource: [["1000.json"]],
        sourceGroups: ["1000.json"],
      } as ReturnType<typeof sampleReport>["deterministic"] & { sourceGroups: string[] },
      history: [{ text: "work", sourceGroups: ["1000.json"] } as { text: string }],
    });
    const stripped = stripLegacyProvenance(record);
    expect(stripped.history).toEqual([{ text: "work" }]);
    expect(
      (stripped.deterministic as { sourceGroups?: string[] }).sourceGroups,
    ).toBeUndefined();
  });
});
