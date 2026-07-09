import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedFinish,
  seedPrepared,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoFinishDir, repoPreparedDir } from "../../../src/lib/config.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

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

import { final } from "../../../src/actions/final.js";

describe("final", () => {
  let restoreHome: () => void;
  let cwd: string;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-final-cwd-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    process.exitCode = undefined;
    promptMock.mockReset();
    promptMock.mockImplementation(async (questions: { name: string }[]) => {
      const answers: Record<string, string> = {};
      for (const q of questions) {
        answers[q.name] = "Answer.";
      }
      return answers;
    });
  });

  afterEach(() => {
    restoreHome();
    fs.rmSync(cwd, { recursive: true });
    vi.restoreAllMocks();
  });

  it("fails without project context", async () => {
    await final({ repo: FAKE_REPO, model: "test-model" });
    expect(process.exitCode).toBe(1);
  });

  it("fails when no prepared narrative exists", async () => {
    writeProjectContext(FAKE_REPO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await final({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No prepared narrative"));
  });

  it("writes reconstruction markdown from answers file", async () => {
    writeProjectContext(FAKE_REPO);
    seedPrepared(FAKE_REPO, "1700000000.json");
    const answersFile = path.join(cwd, "answers.json");
    fs.writeFileSync(
      answersFile,
      JSON.stringify([
        { question: "Was it production?", answer: "Staging only." },
        { question: "Who designed it?", answer: "I did." },
        { question: "Any security impact?", answer: "No." },
        { question: "Customer driven?", answer: "Internal." },
      ]),
    );
    await final({ repo: FAKE_REPO, model: "test-model", answersFile });
    const mdPath = path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.md`);
    expect(fs.existsSync(mdPath)).toBe(true);
    const md = fs.readFileSync(mdPath, "utf8");
    expect(md).toContain("Your IMPACT");
    expect(md).toContain("## CV bullets");
    expect(md).toContain("Built CLI tooling");
    expect(md).toContain("Staging only.");
    expect(fs.existsSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.json"))).toBe(true);
    expect(fs.existsSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.question.json"))).toBe(
      true,
    );
  });

  it("writes period-suffixed reconstruction markdown for final", async () => {
    writeProjectContext(FAKE_REPO, "2022");
    seedPrepared(FAKE_REPO, "1700000000.json", "2022");
    const answersFile = path.join(cwd, "answers.json");
    fs.writeFileSync(
      answersFile,
      JSON.stringify([
        { question: "Was it production?", answer: "Staging only." },
        { question: "Who designed it?", answer: "I did." },
        { question: "Any security impact?", answer: "No." },
        { question: "Customer driven?", answer: "Internal." },
      ]),
    );
    await final({
      repo: FAKE_REPO,
      model: "test-model",
      period: "2022",
      answersFile,
    });
    expect(
      fs.existsSync(path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.2022.md`)),
    ).toBe(true);
  });

  it("extends cumulative Q&A from prior finish when prepared is newer", async () => {
    writeProjectContext(FAKE_REPO);
    seedFinish(FAKE_REPO, "1700000000.json");

    const newPrepared = {
      preparedId: 1_700_345_600,
      sourceReport: "1700345600.json",
      groupCount: 2,
      model: {
        changeTypes: ["feature"],
        technologies: ["TypeScript"],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: ["Reason one", "Reason two", "Reason three", "Reason four"],
        questionsAnalyses: [
          { observation: ["n1"], missingPiece: ["m1"], question: ["Was the extension shipped?"] },
          { observation: ["n2"], missingPiece: ["m2"], question: ["Who owned the rollout?"] },
          { observation: ["n3"], missingPiece: ["m3"], question: ["Any perf impact?"] },
          { observation: ["n4"], missingPiece: ["m4"], question: ["Customer visible?"] },
        ],
        confidence: "medium",
        history: "I extended the feature.",
        provenance: {
          model: "test-model",
          generatedAt: "2026-01-01T00:00:00Z",
          sourceReport: "1700345600.json",
        },
      },
    };
    const preparedDir = repoPreparedDir(FAKE_REPO);
    fs.mkdirSync(preparedDir, { recursive: true });
    fs.writeFileSync(
      path.join(preparedDir, "1700345600.json"),
      `${JSON.stringify(newPrepared, null, 2)}\n`,
    );

    const answersFile = path.join(cwd, "new-answers.json");
    fs.writeFileSync(
      answersFile,
      JSON.stringify([
        { question: "Was the extension shipped?", answer: "Yes, to prod." },
        { question: "Who owned the rollout?", answer: "I did." },
        { question: "Any perf impact?", answer: "Minor." },
        { question: "Customer visible?", answer: "Yes." },
      ]),
    );

    await final({ repo: FAKE_REPO, model: "test-model", answersFile });

    const finishV2 = path.join(repoFinishDir(FAKE_REPO), "1700000000.v2.json");
    expect(fs.existsSync(finishV2)).toBe(true);
    const finish = JSON.parse(fs.readFileSync(finishV2, "utf8")) as {
      version: number;
      answers: { questionId: string; answer: string }[];
      sourcePrepared: string;
      sourcePreviousFinish: string;
      sourceQuestions: Record<number, string[]>;
    };
    expect(finish.version).toBe(2);
    expect(finish.sourcePrepared).toBe("1700345600.json");
    expect(finish.sourcePreviousFinish).toBe("1700000000.json");
    expect(finish.sourceQuestions).toEqual({ 1700000000: ["v1", "v2"] });
    expect(finish.answers).toHaveLength(8);
    expect(finish.answers[0]?.answer).toBe("Staging only.");
    expect(finish.answers[7]?.answer).toBe("Yes.");
    expect(
      fs.existsSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.question.v2.json")),
    ).toBe(true);

    expect(
      fs.existsSync(path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.v2.md`)),
    ).toBe(true);
  });

  it("reuses saved answers when finish JSON already exists", async () => {
    writeProjectContext(FAKE_REPO);
    seedPrepared(FAKE_REPO, "1700000000.json");
    seedFinish(FAKE_REPO, "1700000000.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await final({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith("Reusing saved answers.");
    expect(promptMock).not.toHaveBeenCalled();
  });

  it("regenerates narrative only when extension has no new questions", async () => {
    writeProjectContext(FAKE_REPO);
    seedPrepared(FAKE_REPO, "1700000000.json");
    seedFinish(FAKE_REPO, "1700000000.json");
    const newerPrepared = {
      preparedId: 1_700_345_600,
      sourceReport: "1700345600.json",
      groupCount: 2,
      model: {
        changeTypes: ["feature"],
        technologies: ["TypeScript"],
        technicalSignal: "medium",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: ["Reason one", "Reason two", "Reason three", "Reason four"],
        questionsAnalyses: [
          { observation: ["o1"], missingPiece: ["m1"], question: ["Was it production?"] },
          { observation: ["o2"], missingPiece: ["m2"], question: ["Who designed it?"] },
          { observation: ["o3"], missingPiece: ["m3"], question: ["Any security impact?"] },
          { observation: ["o4"], missingPiece: ["m4"], question: ["Customer driven?"] },
        ],
        confidence: "medium",
        history: "I extended the feature.",
        provenance: {
          model: "test-model",
          generatedAt: "2026-01-01T00:00:00Z",
          sourceReport: "1700345600.json",
        },
      },
    };
    const preparedDir = repoPreparedDir(FAKE_REPO);
    fs.mkdirSync(preparedDir, { recursive: true });
    fs.writeFileSync(
      path.join(preparedDir, "1700345600.json"),
      `${JSON.stringify(newerPrepared, null, 2)}\n`,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await final({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(
      "All prepared questions already answered — regenerating narrative only.",
    );
    expect(promptMock).not.toHaveBeenCalled();
  });

  it("collects answers interactively when no answers file is provided", async () => {
    writeProjectContext(FAKE_REPO);
    seedPrepared(FAKE_REPO, "1700000000.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await final({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith("\nAnswer the questions:");
    expect(promptMock).toHaveBeenCalled();
  });

  it("picks the newest prepared narrative file", async () => {
    writeProjectContext(FAKE_REPO);
    seedPrepared(FAKE_REPO, "1700000000.json");
    const preparedDir = repoPreparedDir(FAKE_REPO);
    fs.writeFileSync(
      path.join(preparedDir, "1699000000.json"),
      `${JSON.stringify(
        {
          preparedId: 1_699_000_000,
          sourceReport: "1699000000.json",
          groupCount: 1,
          model: {
            changeTypes: ["chore"],
            technologies: ["Go"],
            technicalSignal: "low",
            architectureSignal: "low",
            securitySignal: "low",
            signalReasons: ["r1", "r2", "r3", "r4"],
            questionsAnalyses: [
              { observation: ["o1"], missingPiece: ["m1"], question: ["Old question one?"] },
              { observation: ["o2"], missingPiece: ["m2"], question: ["Old question two?"] },
              { observation: ["o3"], missingPiece: ["m3"], question: ["Old question three?"] },
              { observation: ["o4"], missingPiece: ["m4"], question: ["Old question four?"] },
            ],
            confidence: "low",
            history: "Old history.",
            provenance: {
              model: "test-model",
              generatedAt: "2026-01-01T00:00:00Z",
              sourceReport: "1699000000.json",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const answersFile = path.join(cwd, "answers.json");
    fs.writeFileSync(
      answersFile,
      JSON.stringify([
        { question: "Was it production?", answer: "Staging only." },
        { question: "Who designed it?", answer: "I did." },
        { question: "Any security impact?", answer: "No." },
        { question: "Customer driven?", answer: "Internal." },
      ]),
    );
    await final({ repo: FAKE_REPO, model: "test-model", answersFile });
    const md = fs.readFileSync(path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.md`), "utf8");
    expect(md).toContain("TypeScript");
    expect(md).not.toContain("Go");
  });
});
