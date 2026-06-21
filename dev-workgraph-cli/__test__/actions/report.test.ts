import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  sampleReportRecord,
  seedGroup,
  setupWorkgraphHome,
  summarizedGroup,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { emptyDeterministic, sampleGroupModel, sampleReport, sampleReportModel } from "../helpers.js";
import { repoGroupsDir, repoProjectPath, repoReportsDir, setOllamaConfig } from "../../src/lib/config.js";
import { MAX_HISTORY_ENTRIES } from "../../src/lib/report-provenance.js";
import type { GroupRecord, ReportRecord } from "../../src/lib/records.js";
import { chatJson } from "../../src/lib/ollama.js";
import { resolveModel } from "../../src/lib/select.js";

vi.mock("../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../src/lib/ollama.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/ollama.js")>();
  return {
    ...actual,
    chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
      chatJsonFromSchema(opts.schema),
    ),
    resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  };
});

vi.mock("../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

import { report } from "../../src/actions/report.js";

const schemaRequired = (schema: Record<string, unknown>): string[] =>
  (schema.required as string[] | undefined) ?? [];

const sparseGroupModel = {
  signalReasons: { technical: "", architecture: "", security: "" },
} as NonNullable<GroupRecord["model"]>;

function reportWithHistory(count: number, mergeCursor?: number): ReportRecord {
  const history = Array.from({ length: count }, (_, i) => ({ text: `history entry ${i}` }));
  const historySource = Array.from({ length: count }, (_, i) => [`1700000${i}.json`]);
  return sampleReport({
    reportId: 1_700_000_000,
    groupCount: count,
    history,
    mergeCursor,
    sourceGroups: historySource.flat(),
    model: sampleReportModel({
      hiContext: ["Existing work"],
      signalReasons: { technical: ["reason"], architecture: [], security: [] },
    }),
    deterministic: {
      ...emptyDeterministic(),
      historySource,
    },
  });
}

describe("report", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    writeProjectContext(FAKE_REPO);
    vi.mocked(chatJson).mockImplementation(async (opts) => chatJsonFromSchema(opts.schema));
    vi.mocked(resolveModel).mockResolvedValue("test-model");
  });

  afterEach(() => {
    restoreHome();
    vi.clearAllMocks();
  });

  it("does nothing without summarized groups", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No summarized groups"));
  });

  it("seeds a report from the first group", async () => {
    seedGroup(FAKE_REPO, summarizedGroup());
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    const reportFile = path.join(repoReportsDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(reportFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(reportFile, "utf8")) as {
      history: { text: string }[];
      sourceGroups: string[];
    };
    expect(record.history[0]?.text).toContain("scheduler");
    expect(record.sourceGroups).toEqual(["1700000000.json"]);
  });

  it("seeds a report without history when the group has none", async () => {
    seedGroup(
      FAKE_REPO,
      summarizedGroup({
        model: {
          ...summarizedGroup().model!,
          history: "",
        },
      }),
    );
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    const record = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700000000.json"), "utf8"),
    ) as ReportRecord;
    expect(record.history).toEqual([]);
  });

  it("resumes folding when an intermediate report already exists", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("resuming at 2"));
    expect(fs.existsSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"))).toBe(true);
  });

  it("returns early when the report chain is already complete", async () => {
    seedGroup(FAKE_REPO, summarizedGroup());
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Report already complete"));
  });

  it("warns when project context is missing", async () => {
    const projectFile = repoProjectPath(FAKE_REPO);
    if (fs.existsSync(projectFile)) fs.rmSync(projectFile);
    seedGroup(FAKE_REPO, summarizedGroup());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("No project context (run `dev-workgraph init`)"),
    );
  });

  it("logs skipped groups that have no model layer", async () => {
    seedGroup(
      FAKE_REPO,
      summarizedGroup({ timestampEnd: 1_699_900_000, groupId: 1_699_900_000, model: null }),
    );
    seedGroup(FAKE_REPO, summarizedGroup());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("1 skipped: no model"));
  });

  it("respects --limit when folding groups", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    await report({ repo: FAKE_REPO, model: "test-model", force: true, limit: 1 });
    expect(fs.existsSync(path.join(repoReportsDir(FAKE_REPO), "1700000000.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"))).toBe(false);
  });

  it("uses saved reportModel from config when resolving the model", async () => {
    setOllamaConfig({ reportModel: "saved-report-model" });
    seedGroup(FAKE_REPO, summarizedGroup());
    await report({ repo: FAKE_REPO, force: true });
    expect(resolveModel).toHaveBeenCalledWith(
      "http://127.0.0.1:11434",
      undefined,
      expect.objectContaining({ saved: "saved-report-model" }),
    );
  });

  it("falls back to legacy ollama.model when reportModel is unset", async () => {
    setOllamaConfig({ model: "legacy-model" });
    seedGroup(FAKE_REPO, summarizedGroup());
    await report({ repo: FAKE_REPO, force: true });
    expect(resolveModel).toHaveBeenCalledWith(
      "http://127.0.0.1:11434",
      undefined,
      expect.objectContaining({ saved: "legacy-model" }),
    );
  });

  it("folds routine groups without further LLM sessions", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      if (schemaRequired(opts.schema).includes("routine")) {
        return { routine: true, reason: "dependency bump only" };
      }
      return chatJsonFromSchema(opts.schema);
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("routine — folded without further LLM"));

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.history).toEqual([{ text: "Existing history" }]);
    expect(folded.model.lowContext.some((b) => /maintenance|upkeep/i.test(b))).toBe(true);
  });

  it("skips history add when the group has no session history", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup({
      timestampEnd: 1_700_086_400,
      groupId: 1_700_086_400,
      model: {
        ...summarizedGroup().model!,
        history: "",
      },
    });
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[3/4] history add-if-new ... skipped (group has no history)"),
    );
  });

  it("keeps history unchanged when the add-if-new verdict is negative", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      const required = schemaRequired(opts.schema);
      if (required.includes("needed")) return { needed: false };
      return chatJsonFromSchema(opts.schema);
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("nothing new"));

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.history).toEqual([{ text: "Existing history" }]);
  });

  it("compacts history when folding pushes past MAX_HISTORY_ENTRIES", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(reportWithHistory(MAX_HISTORY_ENTRIES, MAX_HISTORY_ENTRIES + 5)),
    );

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(folded.history[0]?.text).toContain("Condensed history entry.");
    expect(folded.mergeCursor).toBe(1);
  });

  it("falls back to concatenation when compaction returns no history strings", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(reportWithHistory(MAX_HISTORY_ENTRIES)),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      const required = schemaRequired(opts.schema);
      const historyProp = (opts.schema.properties as Record<string, Record<string, unknown>>)
        ?.history;
      if (required.includes("history") && historyProp?.type === "array") {
        return { history: [] };
      }
      return chatJsonFromSchema(opts.schema);
    });

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.history[0]?.text).toBe("history entry 0 history entry 1");
  });

  it("wraps mergeCursor to zero after compacting the last valid pair", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(reportWithHistory(MAX_HISTORY_ENTRIES, MAX_HISTORY_ENTRIES - 2)),
    );

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.mergeCursor).toBe(0);
  });

  it("folds groups under a review period subdirectory", async () => {
    writeProjectContext(FAKE_REPO, "2022");
    seedGroup(FAKE_REPO, summarizedGroup(), "2022");
    await report({ repo: FAKE_REPO, model: "test-model", force: true, period: "2022" });
    expect(fs.existsSync(path.join(repoReportsDir(FAKE_REPO, "2022"), "1700000000.json"))).toBe(
      true,
    );
    expect(fs.existsSync(repoGroupsDir(FAKE_REPO, "2022"))).toBe(true);
  });

  it("does not duplicate the maintenance bullet when lowContext already mentions upkeep", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(
        sampleReport({
          reportId: 1_700_000_000,
          deterministic: { ...emptyDeterministic(), historySource: [["1700000000.json"]] },
          model: sampleReportModel({
            hiContext: ["Existing work"],
            lowContext: ["Dependency upkeep only"],
            signalReasons: { technical: ["reason"], architecture: [], security: [] },
          }),
          history: [{ text: "Existing history" }],
        }),
      ),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      if (schemaRequired(opts.schema).includes("routine")) {
        return { routine: true, reason: "version bump" };
      }
      return chatJsonFromSchema(opts.schema);
    });

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    const maintenanceBullets = folded.model.lowContext.filter((b) =>
      /maintenance|upkeep/i.test(b),
    );
    expect(maintenanceBullets).toEqual(["Dependency upkeep only"]);
  });

  it("tolerates sparse merge payloads and keeps prior confidence", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(
        sampleReport({
          reportId: 1_700_000_000,
          deterministic: { ...emptyDeterministic(), historySource: [["1700000000.json"]] },
          model: sampleReportModel({
            hiContext: ["Existing work"],
            confidence: "high",
            signalReasons: { technical: ["reason"], architecture: [], security: [] },
          }),
          history: [{ text: "Existing history" }],
        }),
      ),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      const required = schemaRequired(opts.schema);
      if (required.includes("hiContext") && required.includes("changeTypes")) {
        return {
          changeTypes: "not-an-array",
          hiContext: null,
          mediumContext: ["medium"],
          lowContext: ["low"],
          questions: ["q"],
        };
      }
      if (required.includes("needed")) return { needed: true, text: "   " };
      return chatJsonFromSchema(opts.schema);
    });

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.model.confidence).toBe("high");
    expect(folded.model.changeTypes).toEqual([]);
    expect(folded.model.hiContext).toEqual([]);
    expect(folded.model.mediumContext).toEqual(["medium"]);
    expect(folded.history).toEqual([{ text: "Existing history" }]);
  });

  it("seeds signal reasons from string group fields via initReport", async () => {
    seedGroup(
      FAKE_REPO,
      summarizedGroup({
        model: sampleGroupModel({
          signalReasons: {
            technical: " touched core logic ",
            architecture: "",
            security: " ",
          },
        }),
      }),
    );
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    const record = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700000000.json"), "utf8"),
    ) as ReportRecord;
    expect(record.model.signalReasons.technical).toEqual([" touched core logic "]);
    expect(record.model.signalReasons.architecture).toEqual([]);
    expect(record.model.signalReasons.security).toEqual([]);
  });

  it("defaults missing group model fields during substantive folds", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup({
      timestampEnd: 1_700_086_400,
      groupId: 1_700_086_400,
      model: sparseGroupModel,
    });
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.model.technicalSignal).toBe("low");
    expect(folded.model.changeTypes).toEqual(["feature"]);
    expect(folded.history).toEqual([{ text: "Existing history" }]);
  });

  it("defaults missing model fields when seeding the first report", async () => {
    seedGroup(FAKE_REPO, summarizedGroup({ model: sparseGroupModel }));
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    const record = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700000000.json"), "utf8"),
    ) as ReportRecord;
    expect(record.model.changeTypes).toEqual([]);
    expect(record.model.technologies).toEqual([]);
    expect(record.model.technicalSignal).toBe("low");
    expect(record.model.questions).toEqual([]);
    expect(record.model.hiContext).toEqual([]);
    expect(record.history).toEqual([]);
  });

  it("routine-folds sparse groups without reading missing changeTypes", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup({
      timestampEnd: 1_700_086_400,
      groupId: 1_700_086_400,
      model: sparseGroupModel,
    });
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(
        sampleReport({
          reportId: 1_700_000_000,
          deterministic: { ...emptyDeterministic(), historySource: [["1700000000.json"]] },
          model: sampleReportModel({
            changeTypes: ["infra"],
            hiContext: ["Existing work"],
            signalReasons: { technical: ["reason"], architecture: [], security: [] },
          }),
          history: [{ text: "Existing history" }],
        }),
      ),
    );

    vi.mocked(chatJson).mockImplementation(async (opts) => {
      if (schemaRequired(opts.schema).includes("routine")) {
        return { routine: true, reason: "routine only" };
      }
      return chatJsonFromSchema(opts.schema);
    });

    await report({ repo: FAKE_REPO, model: "test-model" });

    const folded = JSON.parse(
      fs.readFileSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"), "utf8"),
    ) as ReportRecord;
    expect(folded.model.changeTypes).toEqual(["infra"]);
  });
});
