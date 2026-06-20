import { describe, expect, it } from "vitest";
import { areaOf } from "../../src/lib/areas.js";

describe("areaOf", () => {
  it("maps nested paths to the top-level folder", () => {
    expect(areaOf("backend/server.js")).toBe("backend");
    expect(areaOf("docs/guide.md")).toBe("docs");
  });

  it("maps root files to (root)", () => {
    expect(areaOf("README.md")).toBe("(root)");
    expect(areaOf("package.json")).toBe("(root)");
  });
});
