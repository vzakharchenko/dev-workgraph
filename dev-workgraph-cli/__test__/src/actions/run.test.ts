import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_REPO,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import {
  getRepoConfig,
  repoProjectPath,
  setLlmConfig,
  setPeriod,
  setRepoConfig,
} from "../../../src/lib/config.js";

const {
  promptMock,
  initMock,
  evidenceMock,
  summarizeMock,
  commitGroupMock,
  reportMock,
  prepareMock,
  finalMock,
  llmReadyMock,
  getAuthorsMock,
  currentUserEmailMock,
  withProviderStepMock,
  discoverLlmBackendsMock,
} = vi.hoisted(() => ({
  promptMock: vi.fn(),
  initMock: vi.fn(async () => {}),
  evidenceMock: vi.fn(async () => {}),
  summarizeMock: vi.fn(async () => {}),
  commitGroupMock: vi.fn(async () => {}),
  reportMock: vi.fn(async () => {}),
  prepareMock: vi.fn(async () => {}),
  finalMock: vi.fn(async () => {}),
  llmReadyMock: vi.fn(async () => true),
  getAuthorsMock: vi.fn(() => [{ email: "dev@example.com", name: "Dev", commits: 2 }]),
  currentUserEmailMock: vi.fn(() => "dev@example.com"),
  withProviderStepMock: vi.fn(async (_choice: unknown, fn: () => Promise<void>) => fn()),
  discoverLlmBackendsMock: vi.fn(async () => [
    {
      providerId: "ollama" as const,
      baseUrl: "http://127.0.0.1:11434",
      models: ["test-model"],
    },
  ]),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../../src/lib/git.js", () => ({
  resolveRepo: vi.fn((repo: string) => path.resolve(repo === "." ? FAKE_REPO : repo)),
  getAuthors: getAuthorsMock,
  currentUserEmail: currentUserEmailMock,
}));

vi.mock("../../../src/lib/lmstudio-session.js", () => ({
  withProviderStep: (...args: unknown[]) => withProviderStepMock(...args),
}));

vi.mock("../../../src/lib/ollama.js", async () => {
  const { NoLlmBackendsError } = await import("../../../src/lib/llm/install-help.js");
  return {
    providerLabel: vi.fn((id: string) => id),
    discoverLlmBackends: (...args: unknown[]) => discoverLlmBackendsMock(...args),
    noLlmBackendsError: () => new NoLlmBackendsError(),
  };
});

vi.mock("../../../src/lib/select.js", () => ({
  resolveLlmSlot: vi.fn(async (slot: string) => ({
    providerId: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434",
    model: slot === "report" ? "report-model" : slot === "narrative" ? "narrative-model" : "test-model",
  })),
}));

vi.mock("../../../src/actions/check.js", () => ({
  llmReady: llmReadyMock,
}));

vi.mock("../../../src/actions/init.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/actions/init.js")>();
  return { ...actual, init: initMock };
});

vi.mock("../../../src/actions/evidence.js", () => ({ evidence: evidenceMock }));
vi.mock("../../../src/actions/summarize.js", () => ({ summarize: summarizeMock }));
vi.mock("../../../src/actions/commit-group.js", () => ({ commitGroup: commitGroupMock }));
vi.mock("../../../src/actions/report.js", () => ({ report: reportMock }));
vi.mock("../../../src/actions/prepare.js", () => ({ prepare: prepareMock }));
vi.mock("../../../src/actions/final.js", () => ({ final: finalMock }));

import { run } from "../../../src/actions/run.js";
import { resolveLlmSlot } from "../../../src/lib/select.js";

function queueGatheringPrompts(
  overrides: {
    role?: string;
    story?: string;
    picked?: string[];
    days?: number;
    maxCommits?: number;
  } = {},
): void {
  promptMock
    .mockResolvedValueOnce({ role: overrides.role ?? "Senior Developer" })
    .mockResolvedValueOnce({ story: overrides.story ?? "Built the CLI." })
    .mockResolvedValueOnce({ picked: overrides.picked ?? ["dev@example.com"] })
    .mockResolvedValueOnce({ days: overrides.days ?? 7 })
    .mockResolvedValueOnce({ maxCommits: overrides.maxCommits ?? 20 });
}

describe("run", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    promptMock.mockReset();
    llmReadyMock.mockResolvedValue(true);
    getAuthorsMock.mockReturnValue([{ email: "dev@example.com", name: "Dev", commits: 2 }]);
    currentUserEmailMock.mockReturnValue("dev@example.com");
    for (const mock of [
      initMock,
      evidenceMock,
      summarizeMock,
      commitGroupMock,
      reportMock,
      prepareMock,
      finalMock,
      withProviderStepMock,
    ]) {
      mock.mockClear();
    }
    queueGatheringPrompts();
  });

  afterEach(() => {
    restoreHome();
  });

  it("orchestrates the full pipeline with mocked stages", async () => {
    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(initMock).toHaveBeenCalledOnce();
    expect(evidenceMock).toHaveBeenCalledOnce();
    expect(summarizeMock).toHaveBeenCalledOnce();
    expect(commitGroupMock).toHaveBeenCalledOnce();
    expect(reportMock).toHaveBeenCalledOnce();
    expect(prepareMock).toHaveBeenCalledOnce();
    expect(finalMock).toHaveBeenCalledOnce();
  });

  it("throws when ollama is not ready", async () => {
    llmReadyMock.mockResolvedValueOnce(false);
    await expect(run({ repo: FAKE_REPO, model: "test-model" })).rejects.toThrow(/not ready/i);
  });

  it("skips init when project.json already exists", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["dev@example.com"],
      groupThresholdDays: 5,
      groupMaxCommits: 10,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(initMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("\n[1/7] init — skipped (already initialized)");
    expect(log).toHaveBeenCalledWith("Project already initialized — keeping existing context.");
    expect(evidenceMock).toHaveBeenCalledWith(expect.objectContaining({ period: undefined }));
  });

  it("reuses saved authors, group threshold, and max commits", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["saved@example.com"],
      groupThresholdDays: 9,
      groupMaxCommits: 15,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(promptMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Using saved authors: saved@example.com");
    expect(log).toHaveBeenCalledWith("Using saved group threshold: 9 day(s)");
    expect(log).toHaveBeenCalledWith("Using saved max commits/group: 15");
    expect(commitGroupMock).toHaveBeenCalledWith(
      expect.objectContaining({ days: 9, maxCommits: 15 }),
    );
  });

  it("logs unlimited when saved maxCommits is zero", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["saved@example.com"],
      groupThresholdDays: 7,
      groupMaxCommits: 0,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(log).toHaveBeenCalledWith("Using saved max commits/group: unlimited");
    expect(commitGroupMock).toHaveBeenCalledWith(expect.objectContaining({ maxCommits: 0 }));
  });

  it("period run inherits repo context without prompting for role/story", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    setPeriod(FAKE_REPO, "2022", { from: "2022-01-01", to: "2023-01-01" });
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["dev@example.com"],
      groupThresholdDays: 7,
      groupMaxCommits: 20,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ repo: FAKE_REPO, model: "test-model", period: "2022" });

    expect(log).toHaveBeenCalledWith(
      'Period "2022" will inherit the repo-level project context.',
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Review period "2022": 2022-01-01 → 2023-01-01'),
    );
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        period: "2022",
        role: undefined,
        story: undefined,
      }),
    );
    expect(finalMock).toHaveBeenCalledWith(expect.objectContaining({ period: "2022" }));
  });

  it("period run skips init when period project.json already exists", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    writeProjectContext(FAKE_REPO, "2022");
    setPeriod(FAKE_REPO, "2022", { from: "2022-01-01", to: "2023-01-01" });
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["dev@example.com"],
      groupThresholdDays: 7,
      groupMaxCommits: 20,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run({ repo: FAKE_REPO, model: "test-model", period: "2022" });

    expect(initMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("\n[1/7] init — skipped (already initialized)");
  });

  it("throws when no author identities are selected", async () => {
    promptMock.mockReset();
    queueGatheringPrompts({ picked: [] });

    await expect(run({ repo: FAKE_REPO, model: "test-model" })).rejects.toThrow(
      /No author identities selected/,
    );
  });

  it("uses default group threshold when the prompt returns a non-positive number", async () => {
    promptMock.mockReset();
    queueGatheringPrompts({ days: 0 });

    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(getRepoConfig(FAKE_REPO)?.groupThresholdDays).toBe(7);
    expect(commitGroupMock).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }));
  });

  it("uses default max commits when the prompt returns a negative number", async () => {
    promptMock.mockReset();
    queueGatheringPrompts({ maxCommits: -1 });

    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(getRepoConfig(FAKE_REPO)?.groupMaxCommits).toBe(20);
    expect(commitGroupMock).toHaveBeenCalledWith(expect.objectContaining({ maxCommits: 20 }));
  });

  it("resolves period from periodMode and passes it through the pipeline", async () => {
    setPeriod(FAKE_REPO, "2022", { from: "2022-01-01", to: "2023-01-01" });
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["dev@example.com"],
      groupThresholdDays: 7,
      groupMaxCommits: 20,
    });
    promptMock.mockReset();

    await run({
      repo: FAKE_REPO,
      model: "test-model",
      periodMode: true,
      period: "2022",
    });

    expect(evidenceMock).toHaveBeenCalledWith(expect.objectContaining({ period: "2022" }));
    expect(fs.existsSync(repoProjectPath(FAKE_REPO, "2022"))).toBe(false);
  });

  it("pre-checks the current git author in the author checkbox", async () => {
    getAuthorsMock.mockReturnValueOnce([{ email: "dev@example.com", name: "Dev", commits: 1 }]);
    currentUserEmailMock.mockReturnValueOnce("dev@example.com");

    await run({ repo: FAKE_REPO, model: "test-model" });

    const authorPrompt = promptMock.mock.calls.find(
      (call) => (call[0] as { name?: string }[])[0]?.name === "picked",
    )?.[0] as { choices?: { name: string; checked?: boolean }[] }[];
    expect(authorPrompt?.[0]?.choices?.[0]?.name).toContain("1 commit)");
    expect(authorPrompt?.[0]?.choices?.[0]?.checked).toBe(true);
  });

  it("throws when git returns no author candidates", async () => {
    getAuthorsMock.mockReturnValueOnce([]);
    promptMock.mockReset();
    queueGatheringPrompts();

    await expect(run({ repo: FAKE_REPO, model: "test-model" })).rejects.toThrow(
      /No author identities selected/,
    );
  });

  it("wraps each pipeline step with LM Studio session boundaries", async () => {
    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(withProviderStepMock).toHaveBeenCalledTimes(7);
    expect(withProviderStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "ollama", model: "narrative-model" }),
      expect.any(Function),
    );
    expect(withProviderStepMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "ollama", model: "test-model" }),
      expect.any(Function),
    );
  });

  it("skips LM Studio session wrapper for init when project already exists", async () => {
    promptMock.mockReset();
    writeProjectContext(FAKE_REPO);
    setRepoConfig(FAKE_REPO, {
      selectedAuthors: ["dev@example.com"],
      groupThresholdDays: 5,
      groupMaxCommits: 10,
    });

    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(withProviderStepMock).toHaveBeenCalledTimes(6);
    expect(initMock).not.toHaveBeenCalled();
  });

  it("resolves all three llm slots before running the pipeline", async () => {
    setLlmConfig({ model: "legacy-model" });

    await run({ repo: FAKE_REPO, model: "test-model" });

    expect(resolveLlmSlot).toHaveBeenCalledTimes(3);
    expect(resolveLlmSlot).toHaveBeenCalledWith(
      "commit",
      expect.objectContaining({ model: "test-model" }),
    );
    expect(resolveLlmSlot).toHaveBeenCalledWith(
      "report",
      expect.objectContaining({ model: "test-model" }),
    );
    expect(resolveLlmSlot).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({ model: "test-model" }),
    );
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "narrative-model" }),
    );
  });
});
