import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoSummariesDir } from "../../../src/lib/config.js";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedCommit,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";

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
});
