import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedPrepared,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoFinishDir } from "../../src/lib/config.js";

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

import { final } from "../../src/actions/final.js";

describe("final", () => {
  let restoreHome: () => void;
  let cwd: string;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-final-cwd-"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
    fs.rmSync(cwd, { recursive: true, force: true });
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
    await final({ repo: FAKE_REPO, model: "test-model", answersFile, force: true });
    const mdPath = path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.md`);
    expect(fs.existsSync(mdPath)).toBe(true);
    const md = fs.readFileSync(mdPath, "utf8");
    expect(md).toContain("Your IMPACT");
    expect(md).toContain("Staging only.");
    expect(fs.existsSync(path.join(repoFinishDir(FAKE_REPO), "1700000000.json"))).toBe(true);
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
      force: true,
    });
    expect(
      fs.existsSync(path.join(cwd, `RECONSTRUCTION.${path.basename(FAKE_REPO)}.2022.md`)),
    ).toBe(true);
  });
});
