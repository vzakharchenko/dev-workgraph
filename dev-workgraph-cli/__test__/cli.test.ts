import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  authors: vi.fn(async () => {}),
  check: vi.fn(async () => {}),
  commitGroup: vi.fn(async () => {}),
  deepen: vi.fn(async () => {}),
  evidence: vi.fn(async () => {}),
  exportRepo: vi.fn(async () => {}),
  final: vi.fn(async () => {}),
  importRepo: vi.fn(async () => {}),
  init: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  report: vi.fn(async () => {}),
  run: vi.fn(async () => {}),
  summarize: vi.fn(async () => {}),
}));

vi.mock("../src/actions/authors.js", () => ({ authors: actionMocks.authors }));
vi.mock("../src/actions/check.js", () => ({ check: actionMocks.check }));
vi.mock("../src/actions/commit-group.js", () => ({ commitGroup: actionMocks.commitGroup }));
vi.mock("../src/actions/deepen.js", () => ({ deepen: actionMocks.deepen }));
vi.mock("../src/actions/evidence.js", () => ({ evidence: actionMocks.evidence }));
vi.mock("../src/actions/export.js", () => ({ exportRepo: actionMocks.exportRepo }));
vi.mock("../src/actions/final.js", () => ({ final: actionMocks.final }));
vi.mock("../src/actions/import.js", () => ({ importRepo: actionMocks.importRepo }));
vi.mock("../src/actions/init.js", () => ({ init: actionMocks.init }));
vi.mock("../src/actions/prepare.js", () => ({ prepare: actionMocks.prepare }));
vi.mock("../src/actions/report.js", () => ({ report: actionMocks.report }));
vi.mock("../src/actions/run.js", () => ({ run: actionMocks.run }));
vi.mock("../src/actions/summarize.js", () => ({ summarize: actionMocks.summarize }));

describe("cli", () => {
  let program: typeof import("../src/cli.js").program;

  beforeAll(async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    process.argv = ["node", "dev-workgraph"];
    ({ program } = await import("../src/cli.js"));
  });

  beforeEach(() => {
    process.exitCode = undefined;
    for (const fn of Object.values(actionMocks)) {
      fn.mockClear();
      fn.mockResolvedValue(undefined);
    }
  });

  async function runCli(args: string[]): Promise<void> {
    await program.parseAsync(args, { from: "user" });
  }

  it("registers pipeline commands", () => {
    const names = program.commands.map((c) => c.name());
    for (const cmd of [
      "check",
      "init",
      "init:period",
      "authors",
      "evidence",
      "summarize",
      "commit-group",
      "report",
      "prepare",
      "final",
      "deepen",
      "run",
      "run:period",
      "export",
      "import",
    ]) {
      expect(names).toContain(cmd);
    }
  });

  it("exposes name, description, and version", () => {
    expect(program.name()).toBe("dev-workgraph");
    expect(program.description()).toContain("Reconstruct forgotten");
    expect(program.version()).toBe("1.0.0");
  });

  it("check forwards --ollama-url and sets exitCode on failure", async () => {
    await runCli(["check", "--ollama-url", "http://ollama:11434"]);
    expect(actionMocks.check).toHaveBeenCalledWith({ ollama: "http://ollama:11434" });

    actionMocks.check.mockRejectedValueOnce(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["check"]);
    expect(err).toHaveBeenCalledWith("✖ down");
    expect(process.exitCode).toBe(1);
  });

  it("init forwards repo-level options", async () => {
    await runCli([
      "init",
      "./my-repo",
      "--role",
      "Lead",
      "--story",
      "Built it.",
      "--period",
      "2022",
      "--from",
      "2022-01-01",
      "--to",
      "2023-01-01",
      "--ollama-url",
      "http://ollama:11434",
      "--model",
      "test-model",
    ]);
    expect(actionMocks.init).toHaveBeenCalledWith({
      repo: "./my-repo",
      role: "Lead",
      story: "Built it.",
      period: "2022",
      from: "2022-01-01",
      to: "2023-01-01",
      periodMode: false,
      ollama: "http://ollama:11434",
      model: "test-model",
    });
  });

  it("init:period sets periodMode", async () => {
    await runCli(["init:period", "."]);
    expect(actionMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({ repo: ".", periodMode: true }),
    );
  });

  it("authors collects repeatable --email flags", async () => {
    await runCli(["authors", ".", "--email", "a@x.com", "--email", "b@x.com", "--json"]);
    expect(actionMocks.authors).toHaveBeenCalledWith({
      repo: ".",
      email: ["a@x.com", "b@x.com"],
      json: true,
    });
  });

  it("evidence forwards period and emails", async () => {
    await runCli([
      "evidence",
      ".",
      "--email",
      "me@example.com",
      "--period",
      "2022",
    ]);
    expect(actionMocks.evidence).toHaveBeenCalledWith({
      repo: ".",
      email: ["me@example.com"],
      period: "2022",
    });
  });

  it("summarize parses numeric --limit", async () => {
    await runCli([
      "summarize",
      ".",
      "--ollama-url",
      "http://ollama:11434",
      "--model",
      "m",
      "--limit",
      "5",
      "--period",
      "2022",
    ]);
    expect(actionMocks.summarize).toHaveBeenCalledWith({
      repo: ".",
      ollama: "http://ollama:11434",
      model: "m",
      limit: 5,
      period: "2022",
    });
  });

  it("commit-group parses days, max-commits, and limit", async () => {
    await runCli([
      "commit-group",
      ".",
      "--days",
      "7",
      "--max-commits",
      "20",
      "--limit",
      "2",
      "--period",
      "2022",
    ]);
    expect(actionMocks.commitGroup).toHaveBeenCalledWith({
      repo: ".",
      days: 7,
      maxCommits: 20,
      limit: 2,
      period: "2022",
    });
  });

  it("report forwards model pipeline options", async () => {
    await runCli(["report", ".", "--model", "m", "--limit", "3", "--period", "2022"]);
    expect(actionMocks.report).toHaveBeenCalledWith({
      repo: ".",
      model: "m",
      limit: 3,
      period: "2022",
    });
  });

  it("prepare forwards period", async () => {
    await runCli(["prepare", ".", "--period", "2022"]);
    expect(actionMocks.prepare).toHaveBeenCalledWith({
      repo: ".",
      period: "2022",
    });
  });

  it("final forwards answers, output, and period", async () => {
    await runCli([
      "final",
      ".",
      "--answers-file",
      "answers.json",
      "--output",
      "out.md",
      "--model",
      "m",
      "--period",
      "2022",
    ]);
    expect(actionMocks.final).toHaveBeenCalledWith({
      repo: ".",
      answersFile: "answers.json",
      output: "out.md",
      model: "m",
      period: "2022",
    });
  });

  it("deepen forwards context, answers, output, and period", async () => {
    await runCli([
      "deepen",
      ".",
      "--context-file",
      "ctx.txt",
      "--answers-file",
      "new.json",
      "--output",
      "deep.md",
      "--model",
      "m",
      "--period",
      "2022",
    ]);
    expect(actionMocks.deepen).toHaveBeenCalledWith({
      repo: ".",
      contextFile: "ctx.txt",
      answersFile: "new.json",
      output: "deep.md",
      model: "m",
      period: "2022",
    });
  });

  it("run forwards repo-level orchestrator options", async () => {
    await runCli([
      "run",
      ".",
      "--period",
      "2022",
      "--from",
      "2022-01-01",
      "--to",
      "2023-01-01",
      "--model",
      "m",
    ]);
    expect(actionMocks.run).toHaveBeenCalledWith({
      repo: ".",
      period: "2022",
      from: "2022-01-01",
      to: "2023-01-01",
      periodMode: false,
      model: "m",
    });
  });

  it("run:period sets periodMode", async () => {
    await runCli(["run:period", ".", "--period", "2022"]);
    expect(actionMocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: ".", period: "2022", periodMode: true }),
    );
  });

  it("export forwards repo and output", async () => {
    await runCli(["export", ".", "--output", "bundle.tar.gz"]);
    expect(actionMocks.exportRepo).toHaveBeenCalledWith({
      repo: ".",
      output: "bundle.tar.gz",
    });
  });

  it("import forwards tarball and repo override", async () => {
    await runCli(["import", "bundle.tar.gz", "--repo", "/tmp/repo"]);
    expect(actionMocks.importRepo).toHaveBeenCalledWith({
      tarball: "bundle.tar.gz",
      repo: "/tmp/repo",
    });
  });

  it("sets exitCode when an action throws", async () => {
    actionMocks.prepare.mockRejectedValueOnce(new Error("prepare failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["prepare", "."]);
    expect(err).toHaveBeenCalledWith("✖ prepare failed");
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode when export throws", async () => {
    actionMocks.exportRepo.mockRejectedValueOnce(new Error("export failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["export", "."]);
    expect(err).toHaveBeenCalledWith("✖ export failed");
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode when import throws", async () => {
    actionMocks.importRepo.mockRejectedValueOnce(new Error("import failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["import", "missing.tar.gz"]);
    expect(err).toHaveBeenCalledWith("✖ import failed");
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode when deepen throws", async () => {
    actionMocks.deepen.mockRejectedValueOnce(new Error("deepen failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["deepen", "."]);
    expect(err).toHaveBeenCalledWith("✖ deepen failed");
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode when run throws", async () => {
    actionMocks.run.mockRejectedValueOnce(new Error("run failed"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli(["run", "."]);
    expect(err).toHaveBeenCalledWith("✖ run failed");
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ["init", ["init", "."], actionMocks.init],
    ["authors", ["authors", "."], actionMocks.authors],
    ["evidence", ["evidence", "."], actionMocks.evidence],
    ["summarize", ["summarize", "."], actionMocks.summarize],
    ["commit-group", ["commit-group", "."], actionMocks.commitGroup],
    ["report", ["report", "."], actionMocks.report],
    ["final", ["final", "."], actionMocks.final],
  ] as const)("sets exitCode when %s throws", async (name, argv, mock) => {
    mock.mockRejectedValueOnce(new Error(`${name} failed`));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCli([...argv]);
    expect(err).toHaveBeenCalledWith(`✖ ${name} failed`);
    expect(process.exitCode).toBe(1);
  });
});
