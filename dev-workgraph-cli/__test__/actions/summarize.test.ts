import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
}));

vi.mock("../../src/lib/ollama.js", () => ({
  chatJson: chatJsonMock,
  resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  listModels: vi.fn(async () => ["test-model"]),
}));

vi.mock("../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

import { summarize } from "../../src/actions/summarize.js";

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
    const { jsonPath } = seedCommit(FAKE_REPO, { commitHash: "abc1234567890abc1234567890abc1234567890" });
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    const record = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      model: { summary: string; provenance: { model: string } } | null;
    };
    expect(record.model?.summary).toBe("Changed src/a.ts");
    expect(record.model?.provenance.model).toBe("test-model");
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
        questions: [],
        confidence: "low",
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await summarize({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Nothing to do"));
  });
});
