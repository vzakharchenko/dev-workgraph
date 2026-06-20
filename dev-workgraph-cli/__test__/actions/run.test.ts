import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_REPO, setupWorkgraphHome } from "../helpers/action-fixtures.js";

const {
  promptMock,
  initMock,
  evidenceMock,
  summarizeMock,
  commitGroupMock,
  reportMock,
  prepareMock,
  finalMock,
  ollamaReadyMock,
} = vi.hoisted(() => ({
  promptMock: vi.fn(),
  initMock: vi.fn(async () => {}),
  evidenceMock: vi.fn(async () => {}),
  summarizeMock: vi.fn(async () => {}),
  commitGroupMock: vi.fn(async () => {}),
  reportMock: vi.fn(async () => {}),
  prepareMock: vi.fn(async () => {}),
  finalMock: vi.fn(async () => {}),
  ollamaReadyMock: vi.fn(async () => true),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
  getAuthors: vi.fn(() => [{ email: "dev@example.com", name: "Dev", commits: 2 }]),
  currentUserEmail: vi.fn(() => "dev@example.com"),
}));

vi.mock("../../src/lib/ollama.js", () => ({
  resolveBaseUrl: vi.fn(() => "http://127.0.0.1:11434"),
  listModels: vi.fn(async () => ["test-model"]),
}));

vi.mock("../../src/lib/select.js", () => ({
  resolveModel: vi.fn(async () => "test-model"),
}));

vi.mock("../../src/actions/check.js", () => ({
  ollamaReady: ollamaReadyMock,
}));

vi.mock("../../src/actions/init.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/actions/init.js")>();
  return { ...actual, init: initMock };
});

vi.mock("../../src/actions/evidence.js", () => ({ evidence: evidenceMock }));
vi.mock("../../src/actions/summarize.js", () => ({ summarize: summarizeMock }));
vi.mock("../../src/actions/commit-group.js", () => ({ commitGroup: commitGroupMock }));
vi.mock("../../src/actions/report.js", () => ({ report: reportMock }));
vi.mock("../../src/actions/prepare.js", () => ({ prepare: prepareMock }));
vi.mock("../../src/actions/final.js", () => ({ final: finalMock }));

import { run } from "../../src/actions/run.js";

describe("run", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    promptMock.mockReset();
    ollamaReadyMock.mockResolvedValue(true);
    initMock.mockClear();
    evidenceMock.mockClear();
    summarizeMock.mockClear();
    commitGroupMock.mockClear();
    reportMock.mockClear();
    prepareMock.mockClear();
    finalMock.mockClear();
    promptMock
      .mockResolvedValueOnce({ role: "Senior Developer" })
      .mockResolvedValueOnce({ story: "Built the CLI." })
      .mockResolvedValueOnce({ picked: ["dev@example.com"] })
      .mockResolvedValueOnce({ days: 7 })
      .mockResolvedValueOnce({ maxCommits: 20 });
  });

  afterEach(() => {
    restoreHome();
  });

  it("orchestrates the full pipeline with mocked stages", async () => {
    await run({ repo: FAKE_REPO, model: "test-model", force: true });

    expect(initMock).toHaveBeenCalledOnce();
    expect(evidenceMock).toHaveBeenCalledOnce();
    expect(summarizeMock).toHaveBeenCalledOnce();
    expect(commitGroupMock).toHaveBeenCalledOnce();
    expect(reportMock).toHaveBeenCalledOnce();
    expect(prepareMock).toHaveBeenCalledOnce();
    expect(finalMock).toHaveBeenCalledOnce();
  });

  it("throws when ollama is not ready", async () => {
    ollamaReadyMock.mockResolvedValueOnce(false);
    await expect(run({ repo: FAKE_REPO, model: "test-model", force: true })).rejects.toThrow(
      /not ready/i,
    );
  });
});
