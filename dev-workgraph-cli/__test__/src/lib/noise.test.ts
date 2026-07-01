import { describe, expect, it } from "vitest";
import { isNoise } from "../../../src/lib/noise.js";

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
    expect(isNoise("src/app.min.js")).toBe(true);
    expect(isNoise("src/app.js.map")).toBe(true);
  });

  it("flags Java build output", () => {
    expect(isNoise("module/target/classes/Foo.class")).toBe(true);
    expect(isNoise("lib/app.jar")).toBe(true);
    expect(isNoise("src/main/java/Foo.java")).toBe(false);
  });

  it("flags common JS config and dotfiles", () => {
    expect(isNoise(".gitignore")).toBe(true);
    expect(isNoise("jest.config.js")).toBe(true);
    expect(isNoise("eslint.config.mjs")).toBe(true);
  });
});
