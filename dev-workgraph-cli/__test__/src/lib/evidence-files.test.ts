// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  isCanonicalCommitSummaryFile,
  isCommitEvidenceManifestFile,
} from "../../../src/lib/evidence-files.js";

describe("isCommitEvidenceManifestFile", () => {
  it("accepts commit manifest JSON", () => {
    expect(isCommitEvidenceManifestFile("abc123.json")).toBe(true);
  });

  it("rejects split part JSON", () => {
    expect(isCommitEvidenceManifestFile("abc123.part1.json")).toBe(false);
    expect(isCommitEvidenceManifestFile("abc123.part12.json")).toBe(false);
  });
});

describe("isCanonicalCommitSummaryFile", () => {
  it("accepts canonical summary JSON", () => {
    expect(isCanonicalCommitSummaryFile("abc123.json")).toBe(true);
  });

  it("rejects split part and merge summary JSON", () => {
    expect(isCanonicalCommitSummaryFile("abc123.part1.json")).toBe(false);
    expect(isCanonicalCommitSummaryFile("abc123.merge.json")).toBe(false);
  });
});
