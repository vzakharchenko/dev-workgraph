import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatJsonFromSchema,
  FAKE_REPO,
  setupWorkgraphHome,
  writeProjectContext,
} from "../helpers/action-fixtures.js";
import { getRepoConfig, repoProjectPath, setRepoConfig } from "../../src/lib/config.js";

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

import { init, resolveRole, resolveStory } from "../../src/actions/init.js";

describe("resolveRole", () => {
  it("accepts a known role from flags", async () => {
    await expect(resolveRole("Senior Developer")).resolves.toBe("Senior Developer");
  });

  it("rejects an unknown role", async () => {
    await expect(resolveRole("Chief Everything Officer")).rejects.toThrow(/unknown role/i);
  });
});

describe("resolveStory", () => {
  it("returns the flag story verbatim", async () => {
    await expect(resolveStory("Built the CLI.")).resolves.toBe("Built the CLI.");
  });

  it("returns empty string when the flag is empty", async () => {
    await expect(resolveStory("")).resolves.toBe("");
  });
});

describe("init", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
    fs.mkdirSync(FAKE_REPO, { recursive: true });
    fs.writeFileSync(path.join(FAKE_REPO, "README.md"), "# Test project\n");
  });

  afterEach(() => {
    restoreHome();
    fs.rmSync(FAKE_REPO, { recursive: true, force: true });
  });

  it("writes project.json from role and story flags", async () => {
    await init({
      repo: FAKE_REPO,
      role: "Senior Developer",
      story: "Built a CLI tool.",
      model: "test-model",
      force: true,
    });
    const file = repoProjectPath(FAKE_REPO);
    expect(fs.existsSync(file)).toBe(true);
    const ctx = JSON.parse(fs.readFileSync(file, "utf8")) as {
      role: string;
      profile: { summary: string };
    };
    expect(ctx.role).toBe("Senior Developer");
    expect(ctx.profile.summary).toBe("CLI");
  });

  it("skips when project.json already exists", async () => {
    writeProjectContext(FAKE_REPO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await init({ repo: FAKE_REPO, role: "Senior Developer", story: "x" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("already initialized"));
  });

  it("inherits repo-level context for a period", async () => {
    writeProjectContext(FAKE_REPO);
    await init({ repo: FAKE_REPO, period: "2022", from: "2022-01-01", to: "2023-01-01" });
    expect(fs.existsSync(repoProjectPath(FAKE_REPO, "2022"))).toBe(true);
  });

  it("persists role into repo config", async () => {
    await init({
      repo: FAKE_REPO,
      role: "Staff Developer",
      story: "Story",
      model: "test-model",
      force: true,
    });
    expect(getRepoConfig(FAKE_REPO)?.role).toBe("Staff Developer");
  });
});
