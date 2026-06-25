import type {
  CommitRecord,
  DeterministicLayer,
  GroupRecord,
  ModelLayer,
  ReportModelLayer,
  ReportRecord,
} from "../src/lib/records.js";

export function emptyDeterministic(overrides: Partial<DeterministicLayer> = {}): DeterministicLayer {
  return {
    changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
    linesAdded: 0,
    linesDeleted: 0,
    importantFolders: [],
    areas: [],
    excludedFiles: [],
    ...overrides,
  };
}

export function sampleModel(overrides: Partial<ModelLayer> = {}): ModelLayer {
  return {
    summary: "changed something",
    changeTypes: ["feature"],
    technologies: ["TypeScript"],
    technicalSignal: "low",
    architectureSignal: "low",
    securitySignal: "low",
    signalReasons: { technical: "", architecture: "", security: "" },
    questionsAnalysis: [],
    confidence: "medium",
    ...overrides,
  };
}

export function sampleCommit(overrides: Partial<CommitRecord> & { commitHash: string }): CommitRecord {
  return {
    commitHash: overrides.commitHash,
    timestamp: overrides.timestamp ?? 1_700_000_000,
    title: overrides.title ?? "test commit",
    author: overrides.author ?? "dev@example.com",
    deterministic: overrides.deterministic ?? emptyDeterministic(),
    model: overrides.model ?? null,
  };
}

export function sampleReportModel(overrides: Partial<ReportModelLayer> = {}): ReportModelLayer {
  return {
    changeTypes: [],
    technologies: [],
    technicalSignal: "low",
    architectureSignal: "low",
    securitySignal: "low",
    signalReasons: { technical: [], architecture: [], security: [] },
    questionsAnalyses: [],
    confidence: "low",
    hiContext: [],
    mediumContext: [],
    lowContext: [],
    ...overrides,
  };
}

export function sampleReport(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    reportId: 1_700_000_000,
    sourceGroups: ["1000.json"],
    groupCount: 1,
    deterministic: {
      ...emptyDeterministic(),
      historySource: [["1000.json"]],
    },
    model: sampleReportModel(),
    history: [{ text: "did work" }],
    ...overrides,
  };
}

export function sampleGroupModel(
  overrides: Partial<NonNullable<GroupRecord["model"]>> = {},
): NonNullable<GroupRecord["model"]> {
  return {
    changeTypes: ["feature"],
    technologies: ["TypeScript"],
    technicalSignal: "medium",
    architectureSignal: "low",
    securitySignal: "low",
    signalReasons: { technical: "core logic", architecture: "", security: "" },
    questionsAnalyses: [
      {
        observation: ["Diff adds scheduler code."],
        missingPiece: ["Production deployment unknown."],
        question: ["Was this shipped?"],
      },
    ],
    confidence: "medium",
    history: "Implemented the scheduler.",
    hiContext: ["Background job scheduler"],
    mediumContext: [],
    lowContext: [],
    ...overrides,
  };
}

export function sampleGroup(overrides: Partial<GroupRecord> = {}): GroupRecord {
  return {
    groupId: 1_700_000_000,
    timestampStart: 1_700_000_000,
    timestampEnd: 1_700_086_400,
    commitCount: 2,
    groups: {
      commits: ["abc", "def"],
      tiers: { hi: ["abc"], medium: ["def"], low: [] },
    },
    deterministic: emptyDeterministic({
      areas: ["src"],
      linesAdded: 120,
      linesDeleted: 10,
      changedFiles: { added: ["src/new.ts"], deleted: [], modified: ["src/old.ts"], renamed: [] },
    }),
    model: sampleGroupModel(),
    ...overrides,
  };
}
