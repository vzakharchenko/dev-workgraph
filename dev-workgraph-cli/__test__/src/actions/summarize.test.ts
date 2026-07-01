import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoCommitsDir, repoSummariesDir } from "../../../src/lib/config.js";
import { EMPTY_SUMMARIZE_MODEL } from "../../../src/lib/model.js";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  modelLayerPayload,
  seedCommit,
  seedSplitCommit,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { commitMergedSummaryPath, commitSummaryPartPath } from "../../../src/lib/merge-commit-summary.js";

const { chatJsonMock } = vi.hoisted(() => ({
  chatJsonMock: vi.fn(),
}));

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../../src/lib/ollama.js", () => ({
  chatJson: chatJsonMock,
  resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  listModels: vi.fn(async () => ["test-model"]),
}));

vi.mock("../../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

import { summarize } from "../../../src/actions/summarize.js";

describe("summarize", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    writeProjectContext(FAKE_REPO);
    chatJsonMock.mockReset();
    chatJsonMock.mockImplementation(async (opts: { schema: Record<string, unknown> }) =>
      chatJsonFromSchema(opts.schema),
    );
  });

  afterEach(() => {
    restoreHome();
  });

  it("does nothing when no commits are exported", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No exported commits"));
  });

  it("fills the model layer for pending commits", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedCommit(FAKE_REPO, { commitHash: hash });
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    const summaryPath = path.join(repoSummariesDir(FAKE_REPO), "1700000000", `${hash}.json`);
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
      commitHash: string;
      sourceEvidence: string;
      model: { summary: string; provenance: { model: string } };
    };
    expect(summary.commitHash).toBe(hash);
    expect(summary.sourceEvidence).toBe("1700000000");
    expect(summary.model.summary).toBe("Changed src/a.ts");
    expect(summary.model.provenance.model).toBe("test-model");
  });

  it("does not modify evidence JSON", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    const { jsonPath } = seedCommit(FAKE_REPO, { commitHash: hash });
    const before = fs.readFileSync(jsonPath, "utf8");
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(fs.readFileSync(jsonPath, "utf8")).toBe(before);
  });

  it("skips already summarized commits", async () => {
    seedCommit(FAKE_REPO, {
      commitHash: "abc1234567890abc1234567890abc1234567890",
      model: {
        summary: "existing",
        changeTypes: [],
        technologies: [],
        technicalSignal: "low",
        architectureSignal: "low",
        securitySignal: "low",
        signalReasons: { technical: "", architecture: "", security: "" },
        questionsAnalysis: [],
        confidence: "low",
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Nothing to do"));
  });

  it("warns when project context is missing", async () => {
    const { repoProjectPath } = await import("../../../src/lib/config.js");
    fs.rmSync(repoProjectPath(FAKE_REPO), { force: true });
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedCommit(FAKE_REPO, { commitHash: hash });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("No project context (run `dev-workgraph init`)"),
    );
  });

  it("logs a failure when summarization throws", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedCommit(FAKE_REPO, { commitHash: hash });
    chatJsonMock.mockRejectedValueOnce(new Error("model down"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("failed (model down)"));
  });

  it("summarizes split commits into part files, merge.json, and canonical summary", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedSplitCommit(FAKE_REPO, hash);

    let partCall = 0;
    chatJsonMock.mockImplementation(async (opts: { schema: Record<string, unknown> }) => {
      const required = (opts.schema.required as string[] | undefined) ?? [];
      if (required.includes("summary") && required.includes("changeTypes")) {
        partCall += 1;
        const payload = modelLayerPayload();
        return { ...payload, summary: `Part ${partCall}` };
      }
      return chatJsonFromSchema(opts.schema);
    });

    await summarize({ repo: FAKE_REPO, model: "test-model" });

    const summariesDir = repoSummariesDir(FAKE_REPO);
    const part1Path = commitSummaryPartPath(summariesDir, 1_700_000_000, hash, 1);
    const part2Path = commitSummaryPartPath(summariesDir, 1_700_000_000, hash, 2);
    const mergePath = commitMergedSummaryPath(summariesDir, 1_700_000_000, hash);
    const canonicalPath = path.join(summariesDir, "1700000000", `${hash}.json`);

    expect(fs.existsSync(part1Path)).toBe(true);
    expect(fs.existsSync(part2Path)).toBe(true);
    expect(fs.existsSync(mergePath)).toBe(true);
    expect(fs.existsSync(canonicalPath)).toBe(true);
    expect(chatJsonMock).toHaveBeenCalledTimes(5);

    const merged = JSON.parse(fs.readFileSync(mergePath, "utf8")) as {
      model: { summary: string };
    };
    expect(merged.model.summary).toBe("Part 1. Part 2");

    const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")) as {
      model: { summary: string; questionsAnalysis: unknown[] };
    };
    expect(canonical.model.summary).toBe("Final commit summary.");
    expect(canonical.model.questionsAnalysis).toHaveLength(4);
  });

  it("logs split progress by stage and part", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedSplitCommit(FAKE_REPO, hash);

    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      lines.push(String(msg));
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    await summarize({ repo: FAKE_REPO, model: "test-model" });

    const output = lines.join("\n");
    expect(output).toContain("split mode · 2 parts");
    expect(output).toContain("[1/6] summarizing parts");
    expect(output).toContain("[1/2] part 1");
    expect(output).toContain("[2/2] part 2");
    expect(output).toContain("merging part summaries");
    expect(output).toContain("[3/6] polish signal reasons");
    expect(output).toContain("[4/6] compose summary");
    expect(output).toContain("[5/6] reframe questions (4)");
    expect(output).toContain("[6/6] wrote");
    expect(output).toContain("done");

    log.mockRestore();
    write.mockRestore();
  });

  it("writes empty summary without LLM when patch has no substantive diff", async () => {
    const hash = "907a6e4e1fd132b58a830bb161a00c590ffc5269";
    const timestamp = 1_748_611_936;
    const dir = path.join(repoCommitsDir(FAKE_REPO), String(timestamp));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${hash}.json`),
      `${JSON.stringify(
        {
          commitHash: hash,
          timestamp,
          title: "MCD-83: File upload backend",
          author: "mv@unknown.un",
          deterministic: {
            changedFiles: { added: [], deleted: [], modified: [], renamed: [] },
            linesAdded: 0,
            linesDeleted: 0,
            importantFolders: [],
            areas: [],
            excludedFiles: ["frontend/package-lock.json"],
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      path.join(dir, `${hash}.patch`),
      "commit abc\nAuthor: Dev\nDate: Mon Jan 1 2024\n\n",
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      log(String(chunk));
      return true;
    });

    await summarize({ repo: FAKE_REPO, model: "test-model" });

    expect(chatJsonMock).not.toHaveBeenCalled();

    const summaryPath = path.join(repoSummariesDir(FAKE_REPO), String(timestamp), `${hash}.json`);
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
      model: {
        summary: string;
        questionsAnalysis: unknown[];
        provenance: { model: string };
      };
    };
    expect(summary.model.summary).toBe("");
    expect(summary.model.questionsAnalysis).toEqual([]);
    expect(summary.model.provenance.model).toBe(EMPTY_SUMMARIZE_MODEL);

    log.mockRestore();
    write.mockRestore();
  });

  it("finalizes split commits when merge.json exists but canonical summary does not", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedSplitCommit(FAKE_REPO, hash);
    const summariesDir = repoSummariesDir(FAKE_REPO);
    const mergePath = commitMergedSummaryPath(summariesDir, 1_700_000_000, hash);
    fs.mkdirSync(path.dirname(mergePath), { recursive: true });
    fs.writeFileSync(
      mergePath,
      `${JSON.stringify(
        {
          commitHash: hash,
          timestamp: 1_700_000_000,
          sourceEvidence: "1700000000",
          model: modelLayerPayload(),
        },
        null,
        2,
      )}\n`,
    );

    await summarize({ repo: FAKE_REPO, model: "test-model" });

    const canonicalPath = path.join(summariesDir, "1700000000", `${hash}.json`);
    expect(fs.existsSync(canonicalPath)).toBe(true);
    expect(chatJsonMock).toHaveBeenCalledTimes(3);
  });

  it("skips split commits that already have canonical summary", async () => {
    const hash = "abc1234567890abc1234567890abc1234567890";
    seedSplitCommit(FAKE_REPO, hash);
    const summariesDir = repoSummariesDir(FAKE_REPO);
    const canonicalPath = path.join(summariesDir, "1700000000", `${hash}.json`);
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    fs.writeFileSync(
      canonicalPath,
      `${JSON.stringify(
        {
          commitHash: hash,
          timestamp: 1_700_000_000,
          sourceEvidence: "1700000000",
          model: modelLayerPayload(),
        },
        null,
        2,
      )}\n`,
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Nothing to do"));
    expect(chatJsonMock).not.toHaveBeenCalled();
  });
});
