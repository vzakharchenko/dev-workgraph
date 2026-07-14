import { describe, expect, it } from "vitest";
import {
  COMMIT_SUMMARY_SYSTEM,
  GROUP_CLASSIFY_SYSTEM,
  GROUP_COMPOSE_SYSTEM,
  MAX_CONTEXT_BULLETS,
  MAX_HISTORY_ENTRIES,
  MAX_README_CHARS,
  PREPARE_HISTORY_SYSTEM,
  PREPARE_QUESTIONS_SYSTEM,
  PREPARE_REASONS_SYSTEM,
  PREPARE_TECH_SYSTEM,
  PROJECT_PROFILE_SYSTEM,
  REPORT_COMPACT_SYSTEM,
  REPORT_MERGE_SYSTEM,
  REPORT_NEW_HISTORY_SYSTEM,
  ROLE_NARRATIVE_SYSTEM,
  IMPACT_NARRATIVE_SYSTEM,
  ROUTINE_CHECK_SYSTEM,
  STORY_PREPARE_SYSTEM,
  buildCommitUserPrompt,
  buildGroupClassifyPrompt,
  buildGroupComposePrompt,
  buildImpactNarrativePrompt,
  buildDeepenImpactNarrativePrompt,
  buildDeepenQuestionsPrompt,
  combinePreparedAndPriorHistory,
  DEEPEN_QUESTIONS_SYSTEM,
  buildPrepareHistoryPrompt,
  buildPrepareQuestionsPrompt,
  buildPrepareReasonsPrompt,
  buildPrepareTechPrompt,
  buildPathClassifyPrompt,
  buildProjectProfilePrompt,
  buildReportCompactPrompt,
  buildReportMergePrompt,
  buildReportNewHistoryPrompt,
  buildRoleNarrativePrompt,
  buildCvBulletsPrompt,
  buildRoutineCheckPrompt,
  buildStoryPreparePrompt,
  CV_BULLETS_SYSTEM,
  cvEmphasisForRole,
  projectContextBlock,
  withProjectContext,
} from "../../../src/lib/prompts.js";
import type { ProjectContext } from "../../../src/lib/records.js";
import { emptyDeterministic, sampleCommit, sampleGroup, sampleModel, sampleReport } from "../../helpers.js";

const sampleContext = (): ProjectContext => ({
  role: "Senior Developer",
  profile: {
    summary: "Payments platform",
    domains: ["fintech"],
    apparentStack: ["Java", "Kafka"],
    keyThemes: ["migration"],
  },
  story: { raw: "Started in 2020.", preparedContext: "Led backend migration." },
  readme: { present: false },
  provenance: { model: "test", generatedAt: "2026-01-01T00:00:00Z" },
});

describe("projectContextBlock", () => {
  it("returns empty string without init context", () => {
    expect(projectContextBlock(null)).toBe("");
  });

  it("includes role definition and profile grounding", () => {
    const block = projectContextBlock(sampleContext());
    expect(block).toContain("Senior Developer");
    expect(block).toContain("ROLE DEFINITION");
    expect(block).toContain("Senior Software Developer");
    expect(block).toContain("Payments platform");
    expect(block).toContain("Led backend migration.");
  });

  it("uses generic emphasis for unknown roles", () => {
    const block = projectContextBlock({ ...sampleContext(), role: "Consultant" });
    expect(block).toContain("what Git cannot show");
  });
});

describe("cvEmphasisForRole", () => {
  it("returns role-specific CV framing", () => {
    expect(cvEmphasisForRole("Principal Developer")).toContain("system boundaries");
    expect(cvEmphasisForRole("Junior Frontend Developer")).toContain("UI tasks");
  });

  it("falls back for unknown roles", () => {
    expect(cvEmphasisForRole("Consultant")).toContain("no seniority inflation");
  });
});

describe("withProjectContext", () => {
  it("prepends the block when present", () => {
    const block = projectContextBlock(sampleContext());
    expect(withProjectContext(block, "SYSTEM")).toMatch(/^PROJECT CONTEXT[\s\S]+\n\nSYSTEM$/);
  });

  it("returns the system prompt unchanged when block is empty", () => {
    expect(withProjectContext("", "SYSTEM")).toBe("SYSTEM");
  });
});

describe("init prompt builders", () => {
  it("buildStoryPreparePrompt embeds role and story", () => {
    const prompt = buildStoryPreparePrompt("Staff Developer", "Raw notes");
    expect(prompt).toContain("Staff Developer");
    expect(prompt).toContain("Raw notes");
  });

  it("buildStoryPreparePrompt handles empty story", () => {
    expect(buildStoryPreparePrompt("Junior Developer", "")).toContain("(none provided)");
  });

  it("buildProjectProfilePrompt truncates very long README text", () => {
    const prompt = buildProjectProfilePrompt(
      "Senior Developer",
      "prepared",
      "x".repeat(MAX_README_CHARS + 1),
    );
    expect(prompt).toContain("[...truncated...]");
  });

  it("buildPathClassifyPrompt lists extensions and extensionless basenames", () => {
    const prompt = buildPathClassifyPrompt([".ts", ".bin", "Dockerfile"]);
    expect(prompt).toContain("Classify these file extensions and extensionless filenames:");
    expect(prompt).toContain("- .ts");
    expect(prompt).toContain("- .bin");
    expect(prompt).toContain("- Dockerfile");
  });
});

describe("commit summarize prompts", () => {
  it("buildCommitUserPrompt includes patch and metadata", () => {
    const commit = sampleCommit({
      commitHash: "abc123",
      title: "Add feature",
      deterministic: emptyDeterministic({
        areas: ["src"],
        linesAdded: 10,
        linesDeleted: 2,
        changedFiles: { added: ["src/a.ts"], deleted: [], modified: [], renamed: [] },
      }),
    });
    const prompt = buildCommitUserPrompt(commit, "diff line");
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("```diff");
    expect(prompt).toContain("diff line");
  });

  it("buildCommitUserPrompt passes full patch without truncation", () => {
    const commit = sampleCommit({ commitHash: "abc123" });
    const bigPatch = "x".repeat(50_000);
    const prompt = buildCommitUserPrompt(commit, bigPatch);
    expect(prompt).toContain(bigPatch);
    expect(prompt).not.toContain("[...patch truncated");
  });

  it("exports commit summary system prompt", () => {
    expect(COMMIT_SUMMARY_SYSTEM).toContain("SOURCE OF TRUTH");
  });
});

describe("commit-group prompts", () => {
  const members = [
    sampleCommit({
      commitHash: "hi1",
      title: "Core work",
      model: sampleModel({ summary: "Built scheduler", technicalSignal: "high" }),
    }),
    sampleCommit({
      commitHash: "low1",
      title: "Bump deps",
      model: sampleModel({ summary: "Updated lockfile", technicalSignal: "low" }),
    }),
  ];

  it("buildGroupClassifyPrompt includes tier mix and members", () => {
    const group = sampleGroup();
    const prompt = buildGroupClassifyPrompt(group, members);
    expect(prompt).toContain("Tier mix:");
    expect(prompt).toContain("hi1");
    expect(prompt).toContain("[HIGH context]");
  });

  it("buildGroupComposePrompt includes tier bullets and summaries", () => {
    const group = sampleGroup();
    const classify = {
      technicalSignal: "medium",
      architectureSignal: "low",
      securitySignal: "low",
      hiContext: ["Scheduler"],
      mediumContext: [],
      lowContext: ["Deps"],
    };
    const prompt = buildGroupComposePrompt(group, classify, members);
    expect(prompt).toContain("HIGH-tier context");
    expect(prompt).toContain("Built scheduler");
  });

  it("exports group system prompts", () => {
    expect(GROUP_CLASSIFY_SYSTEM).toContain("CLASSIFIES the session");
    expect(GROUP_COMPOSE_SYSTEM).toContain("MERGE the commit summaries");
  });
});

describe("report prompts", () => {
  it("buildRoutineCheckPrompt includes session history", () => {
    const prompt = buildRoutineCheckPrompt(sampleGroup());
    expect(prompt).toContain("Work session of");
    expect(prompt).toContain("Implemented the scheduler.");
  });

  it("buildReportCompactPrompt numbers entries", () => {
    const prompt = buildReportCompactPrompt(["first entry", "second entry"]);
    expect(prompt).toContain("1. first entry");
    expect(prompt).toContain("2. second entry");
  });

  it("buildReportMergePrompt includes both sides", () => {
    const report = sampleReport({
      model: {
        changeTypes: ["feature"],
        technologies: [],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: { technical: ["reason"], architecture: [], security: [] },
        questionsAnalyses: [
          {
            observation: ["Diff adds auth middleware."],
            missingPiece: ["Whether this reached production."],
            question: ["Was this deployed to production?"],
          },
        ],
        confidence: "medium",
        hiContext: ["Existing"],
        mediumContext: [],
        lowContext: [],
      },
    });
    const prompt = buildReportMergePrompt(report, sampleGroup());
    expect(prompt).toContain("ACCUMULATED report model");
    expect(prompt).toContain("NEXT group model");
    expect(prompt).toContain("thread 1:");
    expect(prompt).toContain("Whether this reached production.");
    expect(prompt).toContain("Was this deployed to production?");
  });

  it("buildReportMergePrompt numbers multiple questions per thread on separate lines", () => {
    const report = sampleReport({
      model: {
        ...sampleReport().model,
        questionsAnalyses: [
          {
            observation: ["o1", "o2"],
            missingPiece: ["m1"],
            question: ["First question?", "Second question?"],
          },
        ],
      },
    });
    const prompt = buildReportMergePrompt(report, sampleGroup());
    expect(prompt).toContain("1. o1");
    expect(prompt).toContain("2. o2");
    expect(prompt).toContain("1. First question?");
    expect(prompt).toContain("2. Second question?");
    expect(prompt).not.toContain("First question?; Second question?");
  });

  it("buildReportNewHistoryPrompt includes tiers and histories", () => {
    const prompt = buildReportNewHistoryPrompt(
      ["Existing history"],
      { hiContext: ["Core"], mediumContext: [], lowContext: [] },
      "New session work",
    );
    expect(prompt).toContain("Existing history");
    expect(prompt).toContain("NEW session history");
    expect(prompt).toContain("Core");
  });

  it("exports report system prompts", () => {
    expect(ROUTINE_CHECK_SYSTEM).toContain("routine");
    expect(REPORT_MERGE_SYSTEM).toContain("MERGE");
    expect(REPORT_MERGE_SYSTEM).toContain("missingPiece");
    expect(REPORT_MERGE_SYSTEM).toContain("ONE best question");
    expect(REPORT_MERGE_SYSTEM).toContain("DROP the least valuable");
    expect(REPORT_COMPACT_SYSTEM).toContain("compact");
    expect(REPORT_NEW_HISTORY_SYSTEM).toContain("needed");
    expect(MAX_CONTEXT_BULLETS).toBe(12);
    expect(MAX_HISTORY_ENTRIES).toBe(12);
  });
});

describe("prepare prompts", () => {
  it("buildPrepareTechPrompt lists technologies", () => {
    expect(buildPrepareTechPrompt(["TypeScript", "Node.js"])).toContain("TypeScript");
  });

  it("buildPrepareHistoryPrompt includes signals and history", () => {
    const prompt = buildPrepareHistoryPrompt("Line one\nLine two", {
      technical: "medium",
      architecture: "low",
      security: "low",
    }, ["feature"]);
    expect(prompt).toContain("Line one");
    expect(prompt).toContain("tech=medium");
  });

  it("buildPrepareReasonsPrompt includes reason arrays", () => {
    const prompt = buildPrepareReasonsPrompt(
      { technical: ["t1"], architecture: [], security: [] },
      "composed history",
    );
    expect(prompt).toContain("composed history");
    expect(prompt).toContain("t1");
  });

  it("buildPrepareQuestionsPrompt includes report questionsAnalyses and signal catalog", () => {
    const prompt = buildPrepareQuestionsPrompt(
      "history",
      ["r1"],
      [{ observation: ["obs"], missingPiece: ["miss"], question: ["existing q"] }],
      { technical: ["t-reason"], architecture: [], security: [] },
    );
    expect(prompt).toContain("existing q");
    expect(prompt).toContain("slot 0");
    expect(prompt).toContain("technical[0]");
    expect(prompt).toContain("t-reason");
  });

  it("buildPrepareQuestionsPrompt includes prior Q&A when extending", () => {
    const prompt = buildPrepareQuestionsPrompt(
      "history",
      ["r1"],
      [{ observation: ["obs"], missingPiece: ["miss"], question: ["new q"] }],
      { technical: [], architecture: [], security: [] },
      [{ question: "Old?", answer: "Answered." }],
    );
    expect(prompt).toContain("Prior human Q&A");
    expect(prompt).toContain("Old?");
  });

  it("exports prepare system prompts", () => {
    expect(PREPARE_TECH_SYSTEM).toContain("technologies");
    expect(PREPARE_HISTORY_SYSTEM).toContain("distill");
    expect(PREPARE_REASONS_SYSTEM).toContain("FOUR");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("questionsAnalyses");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("derivedFromThreadIds");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("derivedFromReportSignalRefs");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("whyAsked or evidenceExcerpt");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("missingPiece must state");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("QUESTION STYLE");
    expect(PREPARE_QUESTIONS_SYSTEM).toContain("performance-review");
  });
});

describe("final prompts", () => {
  it("buildRoleNarrativePrompt includes answers and history", () => {
    const prompt = buildRoleNarrativePrompt(
      "I built the API.",
      ["Reason one"],
      [{ question: "Production?", answer: "Yes, staging only." }],
    );
    expect(prompt).toContain("I built the API.");
    expect(prompt).toContain("staging only");
  });

  it("buildImpactNarrativePrompt includes Q&A pairs", () => {
    const prompt = buildImpactNarrativePrompt("Full history text", [
      { question: "Scope?", answer: "Backend only." },
    ]);
    expect(prompt).toContain("Full history text");
    expect(prompt).toContain("Backend only.");
  });

  it("exports final system prompts", () => {
    expect(ROLE_NARRATIVE_SYSTEM).toContain("ROLE NARRATIVE");
    expect(CV_BULLETS_SYSTEM).toContain("ROLE FRAMING");
    expect(IMPACT_NARRATIVE_SYSTEM).toContain("HUMAN ANSWERS");
    expect(STORY_PREPARE_SYSTEM).toContain("preparedContext");
    expect(PROJECT_PROFILE_SYSTEM).toContain("PROFILE");
  });

  it("buildCvBulletsPrompt embeds role and CV emphasis", () => {
    const prompt = buildCvBulletsPrompt(
      "Senior Developer",
      "I built the API.",
      ["Reason one"],
      [{ question: "Production?", answer: "Staging only." }],
      ["I owned the API design."],
    );
    expect(prompt).toContain("Developer role: Senior Developer");
    expect(prompt).toContain("end-to-end feature");
    expect(prompt).toContain("I owned the API design.");
  });
});

describe("deepen prompts", () => {
  it("combinePreparedAndPriorHistory stacks prepare then prior final", () => {
    const combined = combinePreparedAndPriorHistory(
      "Prepared baseline text.",
      "Final refined text.",
    );
    expect(combined).toContain("Baseline from prepare:");
    expect(combined).toContain("Prepared baseline text.");
    expect(combined).toContain("Refined after prior final:");
    expect(combined).toContain("Final refined text.");
  });

  it("combinePreparedAndPriorHistory returns (none) when both layers empty", () => {
    expect(combinePreparedAndPriorHistory("", "")).toBe("(none)");
    expect(combinePreparedAndPriorHistory("  ", "")).toBe("(none)");
  });

  it("buildDeepenImpactNarrativePrompt includes both history layers and Q&A", () => {
    const prompt = buildDeepenImpactNarrativePrompt(
      "From prepare.",
      "From prior final.",
      [{ question: "Q?", answer: "A." }],
      "Recalled note.",
    );
    expect(prompt).toContain("From prepare.");
    expect(prompt).toContain("From prior final.");
    expect(prompt).toContain("Recalled note.");
    expect(prompt).toContain("A.");
  });

  it("buildDeepenQuestionsPrompt includes recalled context and prior Q&A", () => {
    const prompt = buildDeepenQuestionsPrompt({
      preparedHistory: "Prepare history.",
      priorFinalHistory: "Prior final history.",
      preparedSignalSlots: ["r1", "r2", "r3", "r4"],
      reportAnalyses: [{ observation: ["o"], missingPiece: ["m"], question: ["report q1"] }],
      reportSignalReasons: { technical: ["tech reason"], architecture: [], security: [] },
      priorQuestions: ["prepared q1"],
      priorQa: [{ question: "Old?", answer: "Yes." }],
      recalledContext: "Team pivoted after review.",
    });
    expect(prompt).toContain("Team pivoted after review.");
    expect(prompt).toContain("Prepare history.");
    expect(prompt).toContain("Prior final history.");
    expect(prompt).toContain("Old?");
    expect(prompt).toContain("prepared q1");
    expect(prompt).toContain("report q1");
    expect(prompt).toContain("technical[0]");
  });

  it("buildDeepenQuestionsPrompt handles empty prior Q&A and recalled context", () => {
    const prompt = buildDeepenQuestionsPrompt({
      preparedHistory: "Prepare only.",
      priorFinalHistory: "",
      preparedSignalSlots: ["r1", "r2", "r3", "r4"],
      reportAnalyses: [],
      reportSignalReasons: { technical: [], architecture: [], security: [] },
      priorQuestions: [],
      priorQa: [],
      recalledContext: "   ",
    });
    expect(prompt).toContain("(none provided)");
    expect(prompt).toContain("Prior Q&A (do not re-ask these angles):");
    expect(prompt).toContain("(none)");
  });

  it("buildRoleNarrativePrompt and buildImpactNarrativePrompt include recalled context", () => {
    const rolePrompt = buildRoleNarrativePrompt(
      "History.",
      ["Reason"],
      [{ question: "Q?", answer: "A." }],
      "Recalled pivot.",
    );
    expect(rolePrompt).toContain("Recalled pivot.");

    const impactPrompt = buildImpactNarrativePrompt(
      "History.",
      [{ question: "Q?", answer: "A." }],
      "Recalled pivot.",
    );
    expect(impactPrompt).toContain("Recalled pivot.");
  });

  it("exports deepen question system prompt", () => {
    expect(DEEPEN_QUESTIONS_SYSTEM).toContain("questionsAnalyses");
    expect(DEEPEN_QUESTIONS_SYSTEM).toContain("recalled");
  });
});
