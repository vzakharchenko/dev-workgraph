import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  sampleReportRecord,
  seedGroup,
  setupWorkgraphHome,
  summarizedGroup,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoReportsDir } from "../../src/lib/config.js";

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

import { report } from "../../src/actions/report.js";

describe("report", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    writeProjectContext(FAKE_REPO);
  });

  afterEach(() => {
    restoreHome();
  });

  it("does nothing without summarized groups", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No summarized groups"));
  });

  it("seeds a report from the first group", async () => {
    seedGroup(FAKE_REPO, summarizedGroup());
    await report({ repo: FAKE_REPO, model: "test-model", force: true });
    const reportFile = path.join(repoReportsDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(reportFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(reportFile, "utf8")) as {
      history: { text: string }[];
      sourceGroups: string[];
    };
    expect(record.history[0]?.text).toContain("scheduler");
    expect(record.sourceGroups).toEqual(["1700000000.json"]);
  });

  it("resumes folding when an intermediate report already exists", async () => {
    const first = summarizedGroup();
    const second = summarizedGroup();
    second.timestampEnd = 1_700_086_400;
    second.groupId = 1_700_086_400;
    seedGroup(FAKE_REPO, first);
    seedGroup(FAKE_REPO, second);
    fs.mkdirSync(repoReportsDir(FAKE_REPO), { recursive: true });
    fs.writeFileSync(
      path.join(repoReportsDir(FAKE_REPO), "1700000000.json"),
      JSON.stringify(sampleReportRecord()),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await report({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("resuming at 2"));
    expect(fs.existsSync(path.join(repoReportsDir(FAKE_REPO), "1700086400.json"))).toBe(true);
  });
});
