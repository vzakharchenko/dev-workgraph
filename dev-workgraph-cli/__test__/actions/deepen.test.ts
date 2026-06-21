import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedFinish,
  seedPrepared,
  seedReport,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoFinishDir } from "../../src/lib/config.js";
import { latestFinish } from "../../src/lib/finish-load.js";
import { chatJson } from "../../src/lib/ollama.js";

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

import { deepen } from "../../src/actions/deepen.js";

function writeNewAnswersFile(cwd: string): string {
  const answersFile = path.join(cwd, "new-answers.json");
  fs.writeFileSync(
    answersFile,
    JSON.stringify([
      { question: "q1", answer: "New answer one." },
      { question: "q2", answer: "New answer two." },
      { question: "q3", answer: "New answer three." },
      { question: "q4", answer: "New answer four." },
    ]),
  );
  return answersFile;
}

function seedDeepenChain(repoPath: string, period?: string): string {
  seedReport(repoPath, {}, period);
  const preparedFile = seedPrepared(repoPath, "1700000000.json", period);
  seedFinish(repoPath, path.basename(preparedFile), {}, period);
  return preparedFile;
}

describe("deepen", () => {
  let restoreHome: () => void;
  let cwd: string;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-deepen-cwd-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
    fs.rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("fails without project context", async () => {
    await deepen({ repo: FAKE_REPO, model: "test-model" });
    expect(process.exitCode).toBe(1);
  });

  it("fails when no finish archive exists", async () => {
    writeProjectContext(FAKE_REPO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await deepen({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No finish archive"));
  });

  it("fails when latest finish has no saved answers", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);
    const finishDir = repoFinishDir(FAKE_REPO);
    const v1Path = path.join(finishDir, "1700000000.json");
    const record = JSON.parse(fs.readFileSync(v1Path, "utf8")) as { answers: unknown[] };
    record.answers = [];
    fs.writeFileSync(v1Path, JSON.stringify(record));

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await deepen({ repo: FAKE_REPO, model: "test-model", contextFile: "/dev/null" });
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("no saved answers"));
  });

  it("fails when prepared record is missing", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO);
    seedFinish(FAKE_REPO, "missing-prepared.json");

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "note");

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Prepared record not found"));
  });

  it("skips when the next finish version already exists unless --force", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);
    seedFinish(FAKE_REPO, "1700000000.json", {}, undefined, 2);

    const finishDir = repoFinishDir(FAKE_REPO);
    // Orphan v3 slot (lower version cursor) — latest stays v2, but v3.json blocks the next write.
    fs.writeFileSync(
      path.join(finishDir, "1700000000.v3.json"),
      JSON.stringify({ version: 1, answers: [] }),
    );
    expect(latestFinish(finishDir)?.file).toBe("1700000000.v2.json");

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "note");

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(latestFinish(finishDir)?.file).toBe("1700000000.v2.json");
  });

  it("creates the next version with --force when that file already exists", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);
    seedFinish(FAKE_REPO, "1700000000.json", {}, undefined, 2);

    const finishDir = repoFinishDir(FAKE_REPO);
    fs.writeFileSync(
      path.join(finishDir, "1700000000.v3.json"),
      JSON.stringify({ version: 1, answers: [] }),
    );

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "note");

    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
      force: true,
    });

    const v3 = JSON.parse(
      fs.readFileSync(path.join(finishDir, "1700000000.v3.json"), "utf8"),
    ) as { answers: unknown[]; version: number; sourcePreviousFinish?: string };
    expect(v3.answers).toHaveLength(8);
    expect(v3.version).toBe(3);
    expect(v3.sourcePreviousFinish).toBe("1700000000.v2.json");
  });

  it("creates a deepened finish with eight Q&A pairs", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);

    const contextFile = path.join(cwd, "recalled.txt");
    fs.writeFileSync(contextFile, "We pivoted after a security review in Q2.\n");

    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    const finishDir = repoFinishDir(FAKE_REPO);
    expect(latestFinish(finishDir)?.file).toBe("1700000000.v2.json");
    const latest = JSON.parse(
      fs.readFileSync(path.join(finishDir, "1700000000.v2.json"), "utf8"),
    ) as {
      answers: unknown[];
      version: number;
      sourcePreviousFinish?: string;
      recalledContext?: string;
    };
    expect(latest.answers).toHaveLength(8);
    expect(latest.version).toBe(2);
    expect(latest.sourcePreviousFinish).toBe("1700000000.json");
    expect(latest.recalledContext).toContain("security review");
    expect(fs.existsSync(path.join(finishDir, "1700000000.json"))).toBe(true);

    const mdPath = path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.v2.md`);
    const md = fs.readFileSync(mdPath, "utf8");
    expect(md).toContain("New answer four.");
    expect(md).toContain("security review");
    expect(md).toContain("Recalled context (this deepen round)");
  });

  it("omits recalledContext when context file is empty", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);

    const contextFile = path.join(cwd, "empty.txt");
    fs.writeFileSync(contextFile, "   \n");

    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    const latest = JSON.parse(
      fs.readFileSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.v2.json"), "utf8"),
    ) as { recalledContext?: string };
    expect(latest.recalledContext).toBeUndefined();

    const md = fs.readFileSync(
      path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.v2.md`),
      "utf8",
    );
    expect(md).not.toContain("Recalled context (this deepen round)");
  });

  it("extends from latest finish to v3 with twelve cumulative Q&A pairs", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "Round one context.");
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    fs.writeFileSync(contextFile, "Round two context.");
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    const finishDir = repoFinishDir(FAKE_REPO);
    expect(latestFinish(finishDir)?.file).toBe("1700000000.v3.json");
    const v3 = JSON.parse(
      fs.readFileSync(path.join(finishDir, "1700000000.v3.json"), "utf8"),
    ) as {
      answers: unknown[];
      version: number;
      sourcePreviousFinish?: string;
    };
    expect(v3.answers).toHaveLength(12);
    expect(v3.version).toBe(3);
    expect(v3.sourcePreviousFinish).toBe("1700000000.v2.json");
    expect(fs.existsSync(path.join(finishDir, "1700000000.v2.json"))).toBe(true);
  });

  it("writes period-suffixed reconstruction markdown", async () => {
    const period = "2022";
    writeProjectContext(FAKE_REPO, period);
    seedDeepenChain(FAKE_REPO, period);

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "Period note.");
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      period,
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    const mdPath = path.join(
      cwd,
      `RECONSTRUCTION.${path.basename(FAKE_REPO)}.${period}.v2.md`,
    );
    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.existsSync(path.join(repoFinishDir(FAKE_REPO, period), "1700000000.v2.json"))).toBe(
      true,
    );
  });

  it("honours --output for markdown deliverable", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "note");
    const outPath = path.join(cwd, "custom-deepen.md");
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
      output: outPath,
    });

    expect(fs.existsSync(outPath)).toBe(true);
    expect(
      fs.existsSync(path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.v2.md`)),
    ).toBe(false);
  });

  it("fails when the model returns fewer than four new questions", async () => {
    writeProjectContext(FAKE_REPO);
    seedDeepenChain(FAKE_REPO);

    const contextFile = path.join(cwd, "ctx.txt");
    fs.writeFileSync(contextFile, "note");

    vi.mocked(chatJson).mockResolvedValueOnce({ questions: ["only one"], confidence: "low" });

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await deepen({
      repo: FAKE_REPO,
      model: "test-model",
      contextFile,
      answersFile: writeNewAnswersFile(cwd),
    });

    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("fewer than four"));
    expect(fs.existsSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.v2.json"))).toBe(false);
  });
});
