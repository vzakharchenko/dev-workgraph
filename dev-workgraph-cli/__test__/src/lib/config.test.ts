import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPeriod,
  getRepoConfig,
  loadConfig,
  repoCommitsDir,
  repoDataDir,
  setOllamaConfig,
  setPeriod,
  setRepoConfig,
} from "../../../src/lib/config.js";

describe("config", () => {
  let tmpHome: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-test-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty config when no file exists", () => {
    expect(loadConfig()).toEqual({ repos: {} });
  });

  it("persists and reads repo config", () => {
    const repo = "/tmp/example-repo";
    setRepoConfig(repo, { selectedAuthors: ["dev@example.com"], role: "Senior Developer" });
    expect(getRepoConfig(repo)).toEqual({
      selectedAuthors: ["dev@example.com"],
      role: "Senior Developer",
    });
  });

  it("stores and retrieves named periods", () => {
    const repo = "/tmp/example-repo";
    setPeriod(repo, "2022-H1", { from: "2022-01-01", to: "2022-07-01" });
    expect(getPeriod(repo, "2022-H1")).toEqual({
      from: "2022-01-01",
      to: "2022-07-01",
    });
  });

  it("persists ollama preferences", () => {
    setOllamaConfig({ baseUrl: "http://127.0.0.1:11434", commitModel: "qwen2.5-coder:14b" });
    expect(loadConfig().ollama?.commitModel).toBe("qwen2.5-coder:14b");
  });

  it("builds stable repo data paths under WORKGRAPH_HOME", () => {
    const repo = path.resolve("/tmp/my-project");
    expect(repoDataDir(repo)).toContain(tmpHome);
    expect(repoCommitsDir(repo)).toContain("commits");
    expect(repoCommitsDir(repo, "2022")).toContain(`${path.sep}periods${path.sep}2022`);
  });

  it("returns empty config when the file is corrupt", () => {
    const home = process.env.WORKGRAPH_HOME!;
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "config.json"), "{not json");
    expect(loadConfig()).toEqual({ repos: {} });
  });
});
