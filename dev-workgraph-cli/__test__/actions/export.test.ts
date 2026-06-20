import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportRepo } from "../../src/actions/export.js";
import { repoDataDir, setRepoConfig } from "../../src/lib/config.js";

const cliRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = execFileSync("git", ["-C", cliRoot, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

describe("exportRepo", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  let outputPath: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-export-test-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
    outputPath = path.join(tmpHome, "bundle.workgraph.tar.gz");
    process.exitCode = undefined;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("fails when no workgraph data exists", async () => {
    await exportRepo({ repo: cliRoot, output: outputPath });
    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("packages repo data and config into a tarball", async () => {
    const dataDir = repoDataDir(repoRoot);
    fs.mkdirSync(path.join(dataDir, "commits", "1700000000"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "commits", "1700000000", "abc.json"), "{}");
    setRepoConfig(repoRoot, { selectedAuthors: ["dev@example.com"], role: "Senior Developer" });

    await exportRepo({ repo: cliRoot, output: outputPath });

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });
});
