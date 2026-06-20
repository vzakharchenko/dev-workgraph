import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  repoCommitsDir,
  repoGroupsDir,
  repoPreparedDir,
  repoProjectPath,
  repoReportsDir,
} from "../../src/lib/config.js";
import type {
  CommitRecord,
  GroupRecord,
  PreparedRecord,
  ProjectContext,
  ReportRecord,
} from "../../src/lib/records.js";
import {
  emptyDeterministic,
  sampleCommit,
  sampleGroup,
  sampleGroupModel,
  sampleModel,
  sampleReport,
  sampleReportModel,
} from "../helpers.js";

export const FAKE_REPO = "/tmp/workgraph-fake-repo";

export function setupWorkgraphHome(): { tmpHome: string; restore: () => void } {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-actions-"));
  const previous = process.env.WORKGRAPH_HOME;
  process.env.WORKGRAPH_HOME = tmpHome;
  return {
    tmpHome,
    restore: () => {
      if (previous === undefined) delete process.env.WORKGRAPH_HOME;
      else process.env.WORKGRAPH_HOME = previous;
      fs.rmSync(tmpHome, { recursive: true, force: true });
      process.exitCode = undefined;
    },
  };
}

export function writeProjectContext(repoPath: string, period?: string): void {
  const ctx: ProjectContext = {
    role: "Senior Developer",
    profile: {
      summary: "CLI tool",
      domains: ["tooling"],
      apparentStack: ["TypeScript"],
      keyThemes: ["git"],
    },
    story: { raw: "Built a CLI.", preparedContext: "I built a CLI." },
    readme: { present: true, path: "README.md" },
    provenance: { model: "test-model", generatedAt: "2026-01-01T00:00:00Z" },
  };
  const file = repoProjectPath(repoPath, period);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ctx));
}

export function seedCommit(
  repoPath: string,
  overrides: Partial<CommitRecord> & { commitHash: string },
  period?: string,
): { jsonPath: string; patchPath: string } {
  const record = sampleCommit({
    ...overrides,
    model: overrides.model ?? null,
  });
  const dir = path.join(repoCommitsDir(repoPath, period), String(record.timestamp));
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${record.commitHash}.json`);
  const patchPath = path.join(dir, `${record.commitHash}.patch`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(patchPath, "diff --git a/src/a.ts\n+export const x = 1;\n");
  return { jsonPath, patchPath };
}

export function seedGroup(
  repoPath: string,
  overrides: Partial<GroupRecord> = {},
  period?: string,
): string {
  const record = sampleGroup(overrides);
  const groupsDir = repoGroupsDir(repoPath, period);
  fs.mkdirSync(groupsDir, { recursive: true });
  const file = path.join(groupsDir, `${record.timestampEnd}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function seedReport(
  repoPath: string,
  overrides: Partial<ReportRecord> = {},
  period?: string,
): string {
  const record = sampleReport(overrides);
  const reportsDir = repoReportsDir(repoPath, period);
  fs.mkdirSync(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `${record.reportId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function seedPrepared(repoPath: string, reportFile: string, period?: string): string {
  const record: PreparedRecord = {
    preparedId: 1_700_000_000,
    sourceReport: reportFile,
    groupCount: 1,
    model: {
      changeTypes: ["feature"],
      technologies: ["TypeScript"],
      technicalSignal: "medium",
      architectureSignal: "low",
      securitySignal: "low",
      signalReasons: ["Reason one", "Reason two", "Reason three", "Reason four"],
      questions: [
        "Was it production?",
        "Who designed it?",
        "Any security impact?",
        "Customer driven?",
      ],
      confidence: "medium",
      history: "I implemented the feature.",
      provenance: {
        model: "test-model",
        generatedAt: "2026-01-01T00:00:00Z",
        sourceReport: reportFile,
      },
    },
  };
  const dir = repoPreparedDir(repoPath, period);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.preparedId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export const sampleGitCommit = {
  hash: "abc1234567890abc1234567890abc1234567890",
  timestamp: 1_700_000_000,
  email: "dev@example.com",
  name: "Dev",
  subject: "Add feature",
};

export function modelLayerPayload() {
  return {
    summary: "Changed src/a.ts",
    changeTypes: ["feature"],
    technologies: ["TypeScript"],
    technicalSignal: "medium",
    architectureSignal: "low",
    securitySignal: "low",
    signalReasons: { technical: "logic change", architecture: "", security: "" },
    questions: [],
    confidence: "medium",
  };
}

export function groupClassifyPayload() {
  return {
    ...modelLayerPayload(),
    hiContext: ["Core feature"],
    mediumContext: [],
    lowContext: [],
  };
}

export function chatJsonFromSchema(schema: Record<string, unknown>): unknown {
  const required = (schema.required as string[] | undefined) ?? [];
  if (required.includes("preparedContext")) return { preparedContext: "Prepared story." };
  if (required.includes("summary") && required.includes("changeTypes")) {
    return modelLayerPayload();
  }
  if (required.includes("summary") && required.includes("domains")) {
    return {
      summary: "CLI",
      domains: ["tooling"],
      apparentStack: ["TypeScript"],
      keyThemes: ["git"],
    };
  }
  if (required.includes("routine")) return { routine: false, reason: "feature work" };
  if (required.includes("needed")) return { needed: true, text: "Added new capability." };
  const historyProp = (schema.properties as Record<string, Record<string, unknown>> | undefined)
    ?.history;
  if (required.includes("history") && historyProp?.type === "array") {
    return { history: ["Condensed history entry."] };
  }
  if (required.includes("history") && historyProp?.type === "string") {
    return { history: "Session history narrative." };
  }
  if (required.includes("hiContext")) return groupClassifyPayload();
  if (
    required.includes("signalReasons") &&
    (schema.properties as Record<string, Record<string, unknown>>)?.signalReasons?.type ===
      "array"
  ) {
    return { signalReasons: ["r1", "r2", "r3", "r4"] };
  }
  if (required.includes("questions") && required.includes("confidence")) {
    return { questions: ["q1", "q2", "q3", "q4"], confidence: "medium" };
  }
  if (required.includes("technologies") && !required.includes("summary")) {
    return { technologies: ["TypeScript"] };
  }
  if (required.includes("changeTypes") && required.includes("hiContext")) {
    return {
      changeTypes: ["feature"],
      signalReasons: { technical: ["t"], architecture: [], security: [] },
      questions: [],
      confidence: "medium",
      hiContext: ["Core"],
      mediumContext: [],
      lowContext: [],
    };
  }
  if (required.includes("narrative")) {
    return { narrative: ["Bullet one", "Bullet two", "Bullet three", "Bullet four"] };
  }
  return modelLayerPayload();
}

export function summarizedCommit(hash: string): CommitRecord {
  return sampleCommit({
    commitHash: hash,
    timestamp: 1_700_000_000,
    model: sampleModel({ summary: "Did work", technicalSignal: "high" }),
  });
}

export function summarizedGroup(): GroupRecord {
  return sampleGroup({
    timestampEnd: 1_700_000_000,
    model: sampleGroupModel({ history: "Built the scheduler." }),
  });
}

export function sampleReportRecord(): ReportRecord {
  return sampleReport({
    reportId: 1_700_000_000,
    deterministic: { ...emptyDeterministic(), historySource: [["1700000000.json"]] },
    model: sampleReportModel({
      hiContext: ["Existing work"],
      signalReasons: { technical: ["reason"], architecture: [], security: [] },
    }),
    history: [{ text: "Existing history" }],
  });
}
