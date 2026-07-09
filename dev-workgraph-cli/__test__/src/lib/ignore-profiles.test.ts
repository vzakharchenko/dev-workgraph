import { describe, expect, it } from "vitest";
import { ignoreFiles } from "../../../src/lib/ignore.js";
import { AndroidIgnoreFiles } from "../../../src/lib/ignore/AndroidIgnoreFiles.js";
import { JavaIgnoreFiles } from "../../../src/lib/ignore/JavaIgnoreFiles.js";
import { JSIgnoreFiles } from "../../../src/lib/ignore/JSIgnoreFiles.js";
import { isNoise } from "../../../src/lib/noise.js";

describe("ignore profiles", () => {
  it("registers JS, Java, and Android profiles", () => {
    expect(ignoreFiles.map((p) => p.name())).toEqual([
      "JavaScript/Node.js",
      "Java",
      "Android",
    ]);
  });

  it.each([
    [new JSIgnoreFiles(), "JavaScript/Node.js", ["node_modules"], ["package-lock.json"]],
    [new JavaIgnoreFiles(), "Java", ["target"], ["*.class"]],
    [new AndroidIgnoreFiles(), "Android", ["smali"], ["*.smali"]],
  ])("%s exposes dirs and files", (profile, label, dirSample, fileSample) => {
    expect(profile.name()).toBe(label);
    expect(profile.dirs()).toEqual(expect.arrayContaining(dirSample));
    expect(profile.files()).toEqual(expect.arrayContaining(fileSample));
  });
});

describe("isNoise via ignore profiles", () => {
  it("flags Android smali and dex artifacts", () => {
    expect(isNoise("app/smali/com/example/Foo.smali")).toBe(true);
    expect(isNoise("app/smali_classes2/com/example/Bar.smali")).toBe(true);
    expect(isNoise("out/classes.dex")).toBe(true);
    expect(isNoise("src/main/java/Foo.java")).toBe(false);
  });

  it("flags JS build and config directories", () => {
    expect(isNoise("web/.next/server.js")).toBe(true);
    expect(isNoise("pkg/coverage/lcov.info")).toBe(true);
    expect(isNoise("repo/.husky/pre-commit")).toBe(true);
  });

  it("flags Java gradle and output directories", () => {
    expect(isNoise("service/.gradle/cache")).toBe(true);
    expect(isNoise("module/out/production/Foo.class")).toBe(true);
    expect(isNoise("module/bin/Foo.class")).toBe(true);
  });
});
