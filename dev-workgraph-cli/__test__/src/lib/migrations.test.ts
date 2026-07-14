// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { detectArtifactKind, MIGRATION_STEP_KINDS } from "../../../src/lib/migrations/index.js";

describe("migrations registry", () => {
  it("MIGRATION_STEP_KINDS is sorted by toVersion", () => {
    const versions = MIGRATION_STEP_KINDS.map((step) => step.toVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("detectArtifactKind recognizes pipeline paths", () => {
    expect(detectArtifactKind("/data/groups/1.json")).toBe("group");
    expect(detectArtifactKind("/data/reports/1.json")).toBe("report");
    expect(detectArtifactKind("/data/prepared/1.json")).toBe("prepared");
    expect(detectArtifactKind("/data/finish/1.question.json")).toBe("finish-questions");
    expect(detectArtifactKind("/data/finish/1.json")).toBe("finish");
  });
});
