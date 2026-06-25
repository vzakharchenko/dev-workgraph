import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  seedReport,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { repoPreparedDir } from "../../../src/lib/config.js";

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
  resolveModel: vi.fn(async () => "test-model"),
}));

import { prepare } from "../../../src/actions/prepare.js";

describe("prepare", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    process.exitCode = undefined;
  });

  afterEach(() => {
    restoreHome();
  });

  it("fails without project context", async () => {
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(process.exitCode).toBe(1);
  });

  it("fails when no report exists", async () => {
    writeProjectContext(FAKE_REPO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No report found"));
  });

  it("writes a prepared narrative from the latest report", async () => {
    writeProjectContext(FAKE_REPO);
    seedReport(FAKE_REPO, { reportId: 1_700_000_000 });
    await prepare({ repo: FAKE_REPO, model: "test-model" });
    const preparedFile = path.join(repoPreparedDir(FAKE_REPO), "1700000000.json");
    expect(fs.existsSync(preparedFile)).toBe(true);
    const record = JSON.parse(fs.readFileSync(preparedFile, "utf8")) as {
      model: { history: string; questionsAnalyses: unknown[] };
    };
    expect(record.model.history).toBe("Session history narrative.");
    expect(record.model.questionsAnalyses).toHaveLength(4);
  });
});
