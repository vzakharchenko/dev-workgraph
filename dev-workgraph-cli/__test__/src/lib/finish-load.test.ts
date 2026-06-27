import { describe, expect, it } from "vitest";
import {
  defaultReconstructionName,
  extendSourceQuestions,
  finishJsonFileName,
  finishMdFileName,
  finishQuestionVersionLabel,
  finishQuestionsJsonFileName,
  latestFinish,
  loadPreparedRecord,
  loadReportRecord,
  nextFinishVersion,
  normalizeSourceQuestions,
  parseFinishFileName,
  versionedReconstructionName,
} from "../../../src/lib/finish-load.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("finish-load versioning", () => {
  it("parses v1 and versioned finish file names", () => {
    expect(parseFinishFileName("1700000000.json")).toEqual({
      baseFinishId: 1_700_000_000,
      version: 1,
    });
    expect(parseFinishFileName("1700000000.v2.json")).toEqual({
      baseFinishId: 1_700_000_000,
      version: 2,
    });
  });

  it("builds question file names like finish archives", () => {
    expect(finishQuestionsJsonFileName(1_700_000_000, 1)).toBe("1700000000.question.json");
    expect(finishQuestionsJsonFileName(1_700_000_000, 2)).toBe("1700000000.question.v2.json");
    expect(nextFinishVersion("1700000000.json")).toEqual({
      baseFinishId: 1_700_000_000,
      version: 2,
      jsonFile: "1700000000.v2.json",
      mdFile: "1700000000.v2.md",
    });
    expect(nextFinishVersion("1700000000.v2.json").version).toBe(3);
  });

  it("picks the highest version as latest finish", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-load-"));
    fs.writeFileSync(
      path.join(dir, "1700000000.json"),
      JSON.stringify({ version: 1, answers: [] }),
    );
    fs.writeFileSync(
      path.join(dir, "1700000000.v2.json"),
      JSON.stringify({ version: 2, answers: [] }),
    );
    expect(latestFinish(dir)?.file).toBe("1700000000.v2.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("versioned reconstruction names avoid overwriting v1 markdown", () => {
    expect(versionedReconstructionName("/tmp/my-repo", 1)).toBe("RECONSTRUCTION.my-repo.md");
    expect(versionedReconstructionName("/tmp/my-repo", 2)).toBe("RECONSTRUCTION.my-repo.v2.md");
    expect(versionedReconstructionName("/tmp/my-repo", 3, "2022")).toBe(
      "RECONSTRUCTION.my-repo.2022.v3.md",
    );
  });

  it("defaultReconstructionName matches final cwd output", () => {
    expect(defaultReconstructionName("/tmp/my-repo")).toBe("RECONSTRUCTION.my-repo.md");
    expect(defaultReconstructionName("/tmp/my-repo", "2022")).toBe(
      "RECONSTRUCTION.my-repo.2022.md",
    );
  });

  it("rejects invalid finish archive file names", () => {
    expect(() => parseFinishFileName("not-a-finish.json")).toThrow(/Invalid finish archive/);
  });

  it("loadPreparedRecord and loadReportRecord throw when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-load-missing-"));
    expect(() => loadPreparedRecord(dir, "missing.json")).toThrow(/Prepared record not found/);
    expect(() => loadReportRecord(dir, "missing.json")).toThrow(/Report not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("latestFinish falls back to round when version is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-load-round-"));
    fs.writeFileSync(
      path.join(dir, "1700000000.v2.json"),
      JSON.stringify({ round: 2, answers: [] }),
    );
    expect(latestFinish(dir)?.file).toBe("1700000000.v2.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("latestFinish returns null when finish dir is missing", () => {
    expect(latestFinish(path.join(os.tmpdir(), "no-such-finish-dir"))).toBeNull();
  });

  it("builds cumulative sourceQuestions version labels", () => {
    expect(finishQuestionVersionLabel(1)).toBe("v1");
    expect(finishQuestionVersionLabel(2)).toBe("v2");
    expect(extendSourceQuestions(undefined, 1_759_696_393, 1)).toEqual({
      1759696393: ["v1"],
    });
    expect(extendSourceQuestions({ 1759696393: ["v1"] }, 1_759_696_393, 2)).toEqual({
      1759696393: ["v1", "v2"],
    });
    expect(normalizeSourceQuestions("1759696393.question.v2.json")).toEqual({
      1759696393: ["v2"],
    });
  });
});
