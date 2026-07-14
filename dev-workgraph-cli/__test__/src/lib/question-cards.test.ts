import { describe, expect, it, vi } from "vitest";
import type { QuestionAnalyses } from "../../../src/lib/model.js";
import {
  buildEvidenceExcerpt,
  buildWhyAsked,
  dryObservationLine,
  enrichQuestionCards,
  formatEvidenceExcerpt,
  formatQuestionCardLines,
  normalizeQuestionText,
  pickEvidenceObservations,
  polishEvidenceExcerptsWithLlm,
  printQuestionCards,
} from "../../../src/lib/question-cards.js";

vi.mock("../../../src/lib/ollama.js", () => ({
  chatJson: vi.fn(),
}));

import { chatJson } from "../../../src/lib/ollama.js";

describe("question-cards", () => {
  it("buildEvidenceExcerpt uses thread observations and commits, not group metadata", () => {
    const thread: QuestionAnalyses = {
      observation: [
        "Implemented Change-of-Authorization (CoA) via RadiusLogout",
        "Designed DisconnectMessageManager for session termination",
        "Updated Docker configuration for Keycloak 19",
      ],
      missingPiece: ["Cluster target unknown"],
      question: ["Was CoA for clustered deployments?"],
      sourceGroupIds: [1_759_692_840],
      sourceCommits: ["53fe6bf5f770600f", "01c4abc778a3666a"],
    };
    const excerpt = buildEvidenceExcerpt(thread)!;
    expect(excerpt).toContain("- Implemented Change-of-Authorization");
    expect(excerpt).toContain("Related commits: 53fe6bf5, 01c4abc7");
    expect(excerpt).not.toContain("Areas:");
    expect(excerpt).not.toContain(" · ");
  });

  it("pickEvidenceObservations prefers lines relevant to the question", () => {
    const thread: QuestionAnalyses = {
      observation: [
        "Refactored configuration from in-memory storage to JPA",
        "Added RadSec TLS codec and handler logic",
        "Updated README for Mikrotik hotspot UI",
      ],
      missingPiece: ["RadSec driver unknown"],
      question: ["Was RadSec driven by a security requirement for NAS traffic?"],
    };
    const picked = pickEvidenceObservations(thread);
    expect(picked[0]).toMatch(/RadSec/i);
  });

  it("enrichQuestionCards produces different evidence per thread", () => {
    const threads: QuestionAnalyses[] = [
      {
        observation: ["Added RadSec support"],
        missingPiece: ["Security driver unknown"],
        question: ["Why RadSec?"],
      },
      {
        observation: ["Moved configuration from JPA to file-based storage"],
        missingPiece: ["Migration driver unknown"],
        question: ["Why file-based config?"],
      },
    ];
    const enriched = enrichQuestionCards(threads);
    expect(enriched[0]?.evidenceExcerpt).toContain("RadSec");
    expect(enriched[1]?.evidenceExcerpt).toContain("JPA");
    expect(enriched[0]?.evidenceExcerpt).not.toEqual(enriched[1]?.evidenceExcerpt);
  });

  it("dryObservationLine strips third-person narrative", () => {
    expect(dryObservationLine("The developer architected a modular framework")).toBe(
      "architected a modular framework",
    );
  });

  it("normalizeQuestionText removes performance-review openers", () => {
    expect(
      normalizeQuestionText(
        "As a Staff Developer, how did you balance generic protocol support with vendor modules?",
      ),
    ).toBe("how did you balance generic protocol support with vendor modules?");
  });

  it("buildWhyAsked is neutral and derived from missingPiece", () => {
    expect(
      buildWhyAsked({
        observation: [],
        missingPiece: ["Whether compatibility work followed customer SLAs or a roadmap"],
        question: ["Why the upgrades?"],
      }),
    ).toContain("Git cannot establish");
  });

  it("formatQuestionCardLines renders multiline evidence bullets", () => {
    const lines = formatQuestionCardLines(
      {
        observation: [],
        missingPiece: [],
        question: ["Did you design the trust model?"],
        evidenceExcerpt: formatEvidenceExcerpt(
          ["RadSec TLS between NAS and plugin", "OTP handling in auth flow"],
          ["53fe6bf5", "01c4abc7"],
        )!,
        whyAsked: "Git cannot establish this from the evidence alone: Trust boundary unclear.",
      },
      0,
      4,
    );
    const text = lines.join("\n");
    expect(text).toContain("Evidence:");
    expect(text).toContain("- RadSec TLS between NAS and plugin");
    expect(text).toContain("Related commits: 53fe6bf5, 01c4abc7");
  });

  it("enrichQuestionCards normalizes questions and builds whyAsked", () => {
    const enriched = enrichQuestionCards([
      {
        observation: ["Docker scripts added"],
        missingPiece: ["Production use unknown"],
        question: ["Was it production?"],
      },
    ]);
    expect(enriched[0]?.whyAsked).toContain("Production use unknown");
    expect(enriched[0]?.evidenceExcerpt).toContain("- Docker scripts added");
  });

  it("polishEvidenceExcerptsWithLlm applies valid excerpts and falls back on bad output", async () => {
    const threads: QuestionAnalyses[] = [
      {
        observation: ["Added scheduler"],
        missingPiece: ["Prod unknown"],
        question: ["Shipped?"],
      },
      {
        observation: ["Refactored auth"],
        missingPiece: ["Scope unknown"],
        question: ["Why auth?"],
      },
    ];
    vi.mocked(chatJson).mockResolvedValueOnce({
      evidenceExcerpts: [
        "- Scheduler module added.\nRelated commits: abc12345",
        "invalid excerpt without bullets",
      ],
    });
    const polished = await polishEvidenceExcerptsWithLlm({
      threads: enrichQuestionCards(threads),
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      projectBlock: "",
    });
    expect(polished[0]?.evidenceExcerpt).toContain("Scheduler module added");
    expect(polished[1]?.evidenceExcerpt).toContain("Refactored auth");

    vi.mocked(chatJson).mockResolvedValueOnce({ evidenceExcerpts: ["only one"] });
    const unchanged = await polishEvidenceExcerptsWithLlm({
      threads: enrichQuestionCards(threads),
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      projectBlock: "",
    });
    expect(unchanged).toHaveLength(2);
    expect(await polishEvidenceExcerptsWithLlm({
      threads: [],
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      projectBlock: "",
    })).toEqual([]);
  });

  it("formatQuestionCardLines renders lineage-specific source labels", () => {
    const signalReason = formatQuestionCardLines(
      {
        observation: [],
        missingPiece: [],
        question: ["Why iterator?"],
        lineageKind: "signal-reason",
        derivedFromSignalReasonIndex: 1,
      },
      0,
      1,
    );
    expect(signalReason.join("\n")).toContain("Signal reason 2");

    const threadSource = formatQuestionCardLines(
      {
        observation: [],
        missingPiece: [],
        question: ["Q?"],
        derivedFromThreadIds: ["1700000000000001"],
      },
      0,
      1,
    );
    expect(threadSource.join("\n")).toContain("Report threads 1700000000000001");
  });

  it("printQuestionCards writes cards to stdout", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printQuestionCards([
      {
        observation: ["Docker added"],
        missingPiece: ["Prod unknown"],
        question: ["Production?"],
        sourceGroupId: 1_700_000_000,
      },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Q1/1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Work session 1700000000"));
    log.mockRestore();
  });
});
