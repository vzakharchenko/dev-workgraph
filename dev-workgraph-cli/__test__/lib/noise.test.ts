import { describe, expect, it } from "vitest";
import { isNoise } from "../../src/lib/noise.js";

describe("isNoise", () => {
  it("flags vendored directories and lockfiles", () => {
    expect(isNoise("node_modules/pkg/index.js")).toBe(true);
    expect(isNoise("frontend/package-lock.json")).toBe(true);
  });

  it("keeps authored source paths", () => {
    expect(isNoise("src/lib/areas.ts")).toBe(false);
    expect(isNoise("backend/server.js")).toBe(false);
  });

  it("flags minified and source-map artifacts", () => {
    expect(isNoise("dist/app.min.js")).toBe(true);
    expect(isNoise("dist/app.js.map")).toBe(true);
  });
});
