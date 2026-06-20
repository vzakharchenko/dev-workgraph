import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportRepo } from "../../src/actions/export.js";
import { importRepo } from "../../src/actions/import.js";
import { getRepoConfig, repoDataDir, setRepoConfig } from "../../src/lib/config.js";

const cliRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = execFileSync("git", ["-C", cliRoot, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

describe("importRepo", () => {
  let tmpHome: string;
  let previousHome: string | undefined;
  let bundlePath: string;
  let importTarget: string;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workgraph-import-test-"));
    previousHome = process.env.WORKGRAPH_HOME;
    process.env.WORKGRAPH_HOME = tmpHome;
    bundlePath = path.join(tmpHome, "bundle.workgraph.tar.gz");
    importTarget = path.join(tmpHome, "target-repo");
    fs.mkdirSync(importTarget, { recursive: true });
    process.exitCode = undefined;

    const dataDir = repoDataDir(repoRoot);
    fs.mkdirSync(path.join(dataDir, "commits", "1700000000"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "commits", "1700000000", "abc.json"),
      '{"commitHash":"abc"}',
    );
    setRepoConfig(repoRoot, { selectedAuthors: ["dev@example.com"] });
    await exportRepo({ repo: cliRoot, output: bundlePath });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.WORKGRAPH_HOME;
    else process.env.WORKGRAPH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("fails when the bundle is missing", async () => {
    await importRepo({ tarball: path.join(tmpHome, "missing.tar.gz") });
    expect(process.exitCode).toBe(1);
  });

  it("restores data and config from an export bundle", async () => {
    await importRepo({ tarball: bundlePath, repo: importTarget, force: true });
    const restored = repoDataDir(importTarget);
    expect(fs.existsSync(path.join(restored, "commits", "1700000000", "abc.json"))).toBe(true);
    expect(getRepoConfig(importTarget)?.selectedAuthors).toEqual(["dev@example.com"]);
  });

  it("refuses to overwrite without --force", async () => {
    await importRepo({ tarball: bundlePath, repo: importTarget, force: true });
    process.exitCode = undefined;
    await importRepo({ tarball: bundlePath, repo: importTarget });
    expect(process.exitCode).toBe(1);
  });

  it("rejects bundles without manifest.json", async () => {
    const badBundle = path.join(tmpHome, "bad.tar.gz");
    const staging = fs.mkdtempSync(path.join(tmpHome, "bad-stage-"));
    fs.writeFileSync(path.join(staging, "readme.txt"), "not a bundle");
    execFileSync("tar", ["-czf", badBundle, "-C", staging, "readme.txt"], { stdio: "ignore" });
    await importRepo({ tarball: badBundle });
    expect(process.exitCode).toBe(1);
  });
});
