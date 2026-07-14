import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedFinish,
  seedReport,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoFinishDir, repoPreparedDir, repoReportsDir } from "../../../src/lib/config.js";
import { finishQuestionsJsonFileName } from "../../../src/lib/finish-load.js";
import { loadFinishQuestions } from "../../../src/lib/finish-questions.js";
import { sampleReportModel } from "../../helpers.js";

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../../src/lib/ollama.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/ollama.js")>();
  return {
    ...actual,
    chatJson: vi.fn(async (opts: { schema: Record<string, unknown> }) =>
      chatJsonFromSchema(opts.schema),
    ),
    resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  };
});

vi.mock("../../../src/lib/select.js", () => ({
  resolveLlmSlot: vi.fn(async () => ({
    providerId: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434",
    model: "test-model",
  })),
}));

import { prepare } from "../../../src/actions/prepare.js";
import { chatJson } from "../../../src/lib/ollama.js";

describe("prepare", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
  });

  it("fails without project context", async () => {
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(process.exitCode).toBe(1);
  });

  it("fails when no report exists", async () => {
    writeProjectContext(FAKE_REPO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No report found"));
  });

  it("writes a prepared narrative and finish question cards from the latest report", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_000 });
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    const preparedFile = path.join(repoPreparedDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(preparedFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(preparedFile, "utf8")) as {
      model: { history: string; questionsAnalyses?: unknown[] };
    };
    expect(record.model.history).toBe("Session history narrative.");
    expect(record.model.questionsAnalyses ?? []).toHaveLength(0);

    const questionsFile = path.join(
      repoFinishDir(FAKE_REPO),
      finishQuestionsJsonFileName(1_700_000_000, 1),
    );
    expect(fs.existsSync(questionsFile)).toBe(true);
    const questionsRecord = loadFinishQuestions(questionsFile);
    expect(questionsRecord.questionsAnalyses).toHaveLength(4);
  });

  it("skips when prepared narrative already exists", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_010 });
    const preparedFile = path.join(repoPreparedDir(FAKE_REPO), "1700000010.json");
    fs.mkdirSync(path.dirname(preparedFile), { recursive: true });
    fs.writeFileSync(preparedFile, "{}");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("cleans technologies when the report lists stack entries", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, {
      reportId: 1_700_000_011,
      model: sampleReportModel({ technologies: ["TypeScript", "Node.js"] }),
    });
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    const preparedFile = path.join(repoPreparedDir(FAKE_REPO), "1700000011.json");
    const record = JSON.parse(fs.readFileSync(preparedFile, "utf8")) as {
      model: { technologies: string[] };
    };
    expect(record.model.technologies).toEqual(["TypeScript"]);
  });

  it("skips technology cleaning when report has no technologies", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, {
      reportId: 1_700_000_012,
      model: sampleReportModel({ technologies: [] }),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("clean technologies ... skipped"));
  });

  it("continues when evidence polish LLM fails", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_013 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(chatJson).mockImplementation(async (opts) => {
      const required = (opts.schema as { required?: string[] }).required ?? [];
      if (required.includes("evidenceExcerpts")) {
        throw new Error("polish down");
      }
      return chatJsonFromSchema(opts.schema);
    });
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    const preparedFile = path.join(repoPreparedDir(FAKE_REPO), "1700000013.json");
    expect(fs.existsSync(preparedFile)).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped (polish down)"));
  });

  it("reuses prior finish Q&A when a finish archive already exists", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_014 });
    seedFinish(FAKE_REPO, "1700000014.json");
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(fs.existsSync(path.join(repoPreparedDir(FAKE_REPO), "1700000014.json"))).toBe(true);
  });

  it("does not overwrite an existing finish questions file", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_015 });
    const questionsFile = path.join(
      repoFinishDir(FAKE_REPO),
      finishQuestionsJsonFileName(1_700_000_015, 1),
    );
    fs.mkdirSync(path.dirname(questionsFile), { recursive: true });
    fs.writeFileSync(questionsFile, JSON.stringify({ marker: true }));
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(JSON.parse(fs.readFileSync(questionsFile, "utf8"))).toEqual({ marker: true });
  });
});
