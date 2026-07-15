// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  commitContributesReason,
  foldGroupIntoReportReasons,
  isSignalReasonProvenance,
  normalizePreparedSignalReasons,
  normalizeSignalReason,
  reportModelToSignalReasonArrays,
  seedReportReasonsFromGroup,
  signalReasonArrayTexts,
  signalReasonText,
  textsToPreparedSignalReasons,
  foldAndReconcileReportSignalReasons,
  reconcileMergedSignalReasons,
  seedReportReasonsFromGroupWithCommits,
} from "../../../src/lib/signal-reason-provenance.js";

describe("signal-reason-provenance", () => {
  it("isSignalReasonProvenance accepts provenance objects only", () => {
    expect(isSignalReasonProvenance({ text: "x", sourceGroupIds: [1] })).toBe(true);
    expect(isSignalReasonProvenance({ text: "x" })).toBe(false);
    expect(isSignalReasonProvenance("reason")).toBe(false);
    expect(isSignalReasonProvenance(null)).toBe(false);
  });

  it("normalizeSignalReason preserves provenance and dedupes commits", () => {
    const prov = normalizeSignalReason(
      {
        text: "  Core auth refactor  ",
        sourceGroupIds: [1, 1, 2],
        sourceCommits: ["aaa", "aaa", ""],
      },
      [99],
    );
    expect(prov.text).toBe("  Core auth refactor  ");
    expect(prov.sourceGroupIds).toEqual([1, 2]);
    expect(prov.sourceCommits).toEqual(["aaa"]);
  });

  it("normalizeSignalReason falls back to string or empty", () => {
    expect(normalizeSignalReason("legacy reason", [5]).text).toBe("legacy reason");
    expect(normalizeSignalReason(42, [5])).toEqual({
      text: "",
      sourceGroupIds: [5],
      sourceCommits: undefined,
    });
  });

  it("signalReasonText and signalReasonArrayTexts handle mixed values", () => {
    expect(signalReasonText({ text: "a", sourceGroupIds: [] })).toBe("a");
    expect(signalReasonText("plain")).toBe("plain");
    expect(signalReasonText(undefined)).toBe("");
    expect(
      signalReasonArrayTexts([
        " one ",
        { text: "two", sourceGroupIds: [1] },
        "",
        { text: "  ", sourceGroupIds: [] },
      ]),
    ).toEqual([" one ", "two"]);
    expect(signalReasonArrayTexts(undefined)).toEqual([]);
  });

  it("seedReportReasonsFromGroup skips empty dimensions", () => {
    const seeded = seedReportReasonsFromGroup(
      { technical: "Auth module changed", architecture: "", security: "  " },
      1_700_000_000,
    );
    expect(seeded.technical).toHaveLength(1);
    expect(seeded.technical[0]?.text).toBe("Auth module changed");
    expect(seeded.technical[0]?.sourceGroupIds).toEqual([1_700_000_000]);
    expect(seeded.architecture).toEqual([]);
    expect(seeded.security).toEqual([]);
  });

  it("foldGroupIntoReportReasons appends and merges overlapping reasons", () => {
    const groupA = 1_000_000_000;
    const groupB = 2_000_000_000;
    let reasons = seedReportReasonsFromGroup(
      { technical: "Iterator-based export architecture", architecture: "", security: "" },
      groupA,
    );
    reasons = foldGroupIntoReportReasons(
      reasons,
      {
        technical: "Iterator based export architecture for Jira",
        architecture: "New module boundaries",
        security: "",
      },
      groupB,
    );
    expect(reasons.technical).toHaveLength(1);
    expect(reasons.technical[0]?.sourceGroupIds).toEqual(expect.arrayContaining([groupA, groupB]));
    expect(reasons.architecture).toHaveLength(1);
    expect(reasons.architecture[0]?.sourceGroupIds).toEqual([groupB]);
  });

  it("foldGroupIntoReportReasons ignores empty incoming text", () => {
    const prev = seedReportReasonsFromGroup({ technical: "Existing", architecture: "", security: "" }, 1);
    const next = foldGroupIntoReportReasons(prev, { technical: "  ", architecture: "", security: "" }, 2);
    expect(next.technical).toHaveLength(1);
    expect(next.technical[0]?.sourceGroupIds).toEqual([1]);
  });

  it("textsToPreparedSignalReasons pads and truncates to four slots", () => {
    expect(textsToPreparedSignalReasons([]).map((s) => s.text)).toEqual(["", "", "", ""]);
    expect(textsToPreparedSignalReasons(["a", "b"]).map((s) => s.text)).toEqual(["a", "b", "", ""]);
    expect(textsToPreparedSignalReasons(["1", "2", "3", "4", "5"]).map((s) => s.text)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("commitContributesReason checks trimmed dimension text", () => {
    expect(commitContributesReason(undefined, "technical")).toBe(false);
    expect(commitContributesReason({ technical: "  ", architecture: "", security: "" }, "technical")).toBe(
      false,
    );
    expect(
      commitContributesReason({ technical: "real change", architecture: "", security: "" }, "technical"),
    ).toBe(true);
  });

  it("reportModelToSignalReasonArrays normalizes mixed entries", () => {
    const arrays = reportModelToSignalReasonArrays({
      technical: ["legacy string", { text: "provenance", sourceGroupIds: [9] }],
      architecture: ["", { text: "  ", sourceGroupIds: [] }],
      security: [],
    });
    expect(arrays.technical.map((e) => e.text)).toEqual(["legacy string", "provenance"]);
    expect(arrays.technical[1]?.sourceGroupIds).toEqual([9]);
    expect(arrays.architecture).toEqual([]);
  });

  it("foldGroupIntoReportReasons keeps unrelated reasons separate", () => {
    const groupA = 1_000_000_000;
    const groupB = 2_000_000_000;
    let reasons = seedReportReasonsFromGroup(
      { technical: "Kubernetes deployment manifests updated", architecture: "", security: "" },
      groupA,
    );
    reasons = foldGroupIntoReportReasons(
      reasons,
      { technical: "Database indexing performance tuning", architecture: "", security: "" },
      groupB,
    );
    expect(reasons.technical).toHaveLength(2);
  });

  it("reconcileMergedSignalReasons attaches provenance to LLM merge output", () => {
    const groupId = 1_700_086_400;
    let folded = seedReportReasonsFromGroup(
      { technical: "Iterator-based export architecture", architecture: "", security: "" },
      1_700_000_000,
    );
    const group = {
      timestampEnd: groupId,
      model: {
        signalReasons: {
          technical: "Iterator based export architecture for Jira",
          architecture: "",
          security: "",
        },
      },
      groups: { commits: [], sourceSummaries: [] },
    } as import("../../../src/lib/records.js").GroupRecord;
    folded = foldGroupIntoReportReasons(folded, group.model.signalReasons, groupId);
    const reconciled = reconcileMergedSignalReasons(
      folded,
      { technical: ["Iterator based export architecture for Jira"], architecture: [], security: [] },
      groupId,
      group,
      "/tmp",
    );
    expect(reconciled.technical[0]?.text).toBe("Iterator based export architecture for Jira");
    expect(reconciled.technical[0]?.sourceGroupIds).toEqual(
      expect.arrayContaining([1_700_000_000, groupId]),
    );
  });

  it("foldAndReconcileReportSignalReasons preserves prior provenance when LLM rephrases", () => {
    const groupId = 1_700_086_400;
    const prev = {
      technical: [{ text: "Core auth refactor", sourceGroupIds: [1_700_000_000], sourceCommits: ["abc"] }],
      architecture: [],
      security: [],
    };
    const group = {
      timestampEnd: groupId,
      model: { signalReasons: { technical: "", architecture: "", security: "" } },
      groups: { commits: [], sourceSummaries: [] },
    } as import("../../../src/lib/records.js").GroupRecord;
    const reconciled = foldAndReconcileReportSignalReasons(
      prev,
      group,
      { technical: ["Core auth refactor"], architecture: [], security: [] },
      "/tmp",
    );
    expect(reconciled.technical[0]).toEqual({
      text: "Core auth refactor",
      sourceGroupIds: [1_700_000_000],
      sourceCommits: ["abc"],
    });
  });
});
