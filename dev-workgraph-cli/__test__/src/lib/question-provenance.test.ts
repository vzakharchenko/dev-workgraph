import { describe, expect, it } from "vitest";
import type { QuestionAnalyses } from "../../../src/lib/model.js";
import {
  attachGroupQuestionProvenance,
  attachPrepareQuestionProvenance,
  attachReportMergeProvenance,
  makeThreadId,
  resolvePrepareQuestionProvenanceFromLlm,
  seedReportQuestionProvenance,
} from "../../../src/lib/question-provenance.js";
import type { ReportSignalReasonArrays } from "../../../src/lib/signal-reason-provenance.js";
import { sampleCommit } from "../../helpers.js";

describe("question-provenance", () => {
  it("makeThreadId is a numeric opaque id; position lives in groupThreadIndex", () => {
    expect(makeThreadId(1_700_345_600, 2)).toBe("1700345600000002");
  });

  it("attachGroupQuestionProvenance links observations to commits", () => {
    const groupId = 1_700_000_000;
    const members = [
      sampleCommit({
        commitHash: "a".repeat(40),
        title: "Add Docker deploy",
        model: {
          summary: "Added Docker deploy scripts for local setup.",
          questionsAnalysis: [
            {
              observation: "The diff adds Docker deploy scripts.",
              missingPiece: "Unclear whether this reached production.",
              question: "Was this deployed to production?",
            },
          ],
        },
      }),
    ];
    const analyses: QuestionAnalyses[] = [
      {
        observation: ["The diff adds Docker deploy scripts."],
        missingPiece: ["Unclear whether this reached production."],
        question: ["Was this deployed to production?"],
      },
    ];
    const enriched = attachGroupQuestionProvenance(analyses, members, groupId);
    expect(enriched[0]?.threadId).toBe(makeThreadId(groupId, 0));
    expect(enriched[0]?.groupThreadIndex).toBe(0);
    expect(enriched[0]?.sourceGroupId).toBe(groupId);
    expect(enriched[0]?.sourceGroupIds).toEqual([groupId]);
    expect(enriched[0]?.sourceCommits?.[0]).toBe("a".repeat(40));
  });

  it("seedReportQuestionProvenance preserves group thread ids", () => {
    const groupId = 1_700_000_000;
    const seeded = seedReportQuestionProvenance(
      [
        {
          observation: ["o"],
          missingPiece: ["m"],
          question: ["q"],
          threadId: "1700000000000000",
          groupThreadIndex: 0,
        },
      ],
      groupId,
    );
    expect(seeded[0]?.threadId).toBe("1700000000000000");
    expect(seeded[0]?.sourceGroupIds).toContain(groupId);
  });

  it("attachReportMergeProvenance unions parent threads", () => {
    const prev: QuestionAnalyses[] = [
      {
        threadId: "1000000000000000",
        groupThreadIndex: 0,
        observation: ["Docker deploy scripts added"],
        missingPiece: ["Production use unknown"],
        question: ["Was Docker used in production?"],
        sourceGroupId: 1_000_000_000,
        sourceGroupIds: [1_000_000_000],
        sourceCommits: ["aaa"],
      },
    ];
    const group: QuestionAnalyses[] = [
      {
        threadId: "2000000000000000",
        groupThreadIndex: 0,
        observation: ["Docker compose for radius"],
        missingPiece: ["Production use unknown"],
        question: ["Was compose setup production-ready?"],
        sourceGroupId: 2_000_000_000,
        sourceGroupIds: [2_000_000_000],
        sourceCommits: ["bbb"],
      },
    ];
    const merged: QuestionAnalyses[] = [
      {
        observation: ["Docker deploy scripts added", "Docker compose for radius"],
        missingPiece: ["Production use unknown"],
        question: ["Was the Docker setup used in production?"],
      },
    ];
    const reportId = 2_000_000_000;
    const enriched = attachReportMergeProvenance(merged, prev, group, 2_000_000_000, reportId);
    expect(enriched[0]?.derivedFromThreadIds).toEqual(
      expect.arrayContaining(["1000000000000000", "2000000000000000"]),
    );
    expect(enriched[0]?.sourceGroupIds).toEqual(
      expect.arrayContaining([1_000_000_000, 2_000_000_000]),
    );
    expect(enriched[0]?.sourceCommits).toEqual(expect.arrayContaining(["aaa", "bbb"]));
  });

  it("attachPrepareQuestionProvenance resolves lineage by explicit thread id only", () => {
    const report: QuestionAnalyses[] = [
      {
        threadId: "3000000000000002",
        groupThreadIndex: 2,
        observation: ["RadSec TLS integration"],
        missingPiece: ["Security boundary with adjacent systems unclear"],
        question: ["What are the security boundaries?"],
        sourceGroupIds: [3_000_000_000],
        sourceCommits: ["ccc"],
      },
    ];
    const reframed: QuestionAnalyses[] = [
      {
        observation: ["RadSec TLS integration in the plugin"],
        missingPiece: ["Security boundary with adjacent systems unclear"],
        question: ["What security boundaries did you define for RadSec?"],
        derivedFromThreadIds: ["3000000000000002"],
      },
    ];
    const enriched = attachPrepareQuestionProvenance(reframed, report);
    expect(enriched[0]?.threadIndex).toBe(0);
    expect(enriched[0]?.derivedFromThreadIds).toContain("3000000000000002");
    expect(enriched[0]?.sourceGroupIds).toContain(3_000_000_000);
    expect(enriched[0]?.sourceCommits).toContain("ccc");
  });

  it("resolvePrepareQuestionProvenanceFromLlm unions report signal refs by index", () => {
    const report: QuestionAnalyses[] = [];
    const reportSignalReasons: ReportSignalReasonArrays = {
      technical: [],
      architecture: [
        {
          text: "Iterator-based export architecture",
          sourceGroupIds: [1_783_659_928, 1_783_600_000],
          sourceCommits: ["def456"],
        },
      ],
      security: [],
    };
    const reframed: QuestionAnalyses[] = [
      {
        observation: ["Implemented IteratorFactory for Jira export"],
        missingPiece: ["Why Iterator pattern was chosen"],
        question: ["What led you to choose the Iterator pattern for data retrieval?"],
        derivedFromReportSignalRefs: [{ dimension: "architecture", index: 0 }],
        derivedFromPreparedSignalSlots: [0],
      },
    ];
    const enriched = resolvePrepareQuestionProvenanceFromLlm(
      reframed,
      report,
      reportSignalReasons,
    );
    expect(enriched[0]?.lineageKind).toBe("signal-reason");
    expect(enriched[0]?.derivedFromSignalReasonIndex).toBe(0);
    expect(enriched[0]?.sourceGroupIds).toEqual(
      expect.arrayContaining([1_783_659_928, 1_783_600_000]),
    );
    expect(enriched[0]?.sourceCommits).toContain("def456");
  });
});
