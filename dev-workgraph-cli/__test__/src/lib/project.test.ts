import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoProjectPath } from "../../../src/lib/config.js";
import { loadProjectContext, ROLES } from "../../../src/lib/project.js";
import type { ProjectContext } from "../../../src/lib/records.js";

describe("project", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  const repo = path.resolve("/tmp/project-context-repo");

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-project-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("exports the init role list", () => {
    expect(ROLES).toContain("Senior Developer");
    expect(ROLES[0]).toBe("Principal Developer");
  });

  it("loads project context from disk", () => {
    const ctx: ProjectContext = {
      role: "Senior Developer",
      profile: {
        summary: "CLI tool",
        domains: ["developer tooling"],
        apparentStack: ["TypeScript"],
        keyThemes: ["git history"],
      },
      story: { raw: "I built it.", preparedContext: "Built a CLI." },
      readme: { present: false },
      provenance: { model: "test", generatedAt: "2026-01-01T00:00:00Z" },
    };
    const file = repoProjectPath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(ctx));
    expect(loadProjectContext(repo)).toEqual(ctx);
  });

  it("prefers period-scoped project.json when present", () => {
    const repoCtx: ProjectContext = {
      role: "Senior Developer",
      profile: {
        summary: "all-time",
        domains: [],
        apparentStack: [],
        keyThemes: [],
      },
      story: { raw: "", preparedContext: "" },
      readme: { present: false },
      provenance: { model: "test", generatedAt: "2026-01-01T00:00:00Z" },
    };
    const periodCtx: ProjectContext = {
      ...repoCtx,
      profile: { ...repoCtx.profile, summary: "period-scoped" },
    };
    fs.mkdirSync(path.dirname(repoProjectPath(repo)), { recursive: true });
    fs.writeFileSync(repoProjectPath(repo), JSON.stringify(repoCtx));
    fs.mkdirSync(path.dirname(repoProjectPath(repo, "2022")), { recursive: true });
    fs.writeFileSync(repoProjectPath(repo, "2022"), JSON.stringify(periodCtx));
    expect(loadProjectContext(repo, "2022")?.profile.summary).toBe("period-scoped");
  });

  it("returns null when init has not run", () => {
    expect(loadProjectContext(repo)).toBeNull();
  });

  it("skips corrupt project.json and tries the next candidate", () => {
    fs.mkdirSync(path.dirname(repoProjectPath(repo, "2022")), { recursive: true });
    fs.writeFileSync(repoProjectPath(repo, "2022"), "{bad json");
    const repoCtx: ProjectContext = {
      role: "Senior Developer",
      profile: { summary: "fallback", domains: [], apparentStack: [], keyThemes: [] },
      story: { raw: "", preparedContext: "" },
      readme: { present: false },
      provenance: { model: "test", generatedAt: "2026-01-01T00:00:00Z" },
    };
    fs.mkdirSync(path.dirname(repoProjectPath(repo)), { recursive: true });
    fs.writeFileSync(repoProjectPath(repo), JSON.stringify(repoCtx));
    expect(loadProjectContext(repo, "2022")?.profile.summary).toBe("fallback");
  });
});
