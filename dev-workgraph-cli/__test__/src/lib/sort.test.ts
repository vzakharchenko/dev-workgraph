import { describe, expect, it } from "vitest";
import { compareLocale, uniqSorted } from "../../../src/lib/sort.js";

describe("compareLocale", () => {
  it("orders strings alphabetically", () => {
    expect(compareLocale("alpha", "beta")).toBeLessThan(0);
    expect(compareLocale("beta", "alpha")).toBeGreaterThan(0);
    expect(compareLocale("same", "same")).toBe(0);
  });

  it("matches Array.sort with localeCompare", () => {
    const input = ["zeta", "alpha", "mike", "bravo"];
    const sorted = [...input].sort(compareLocale);
    expect(sorted).toEqual([...input].sort((a, b) => a.localeCompare(b)));
  });
});

describe("uniqSorted", () => {
  it("returns unique values in locale-aware order", () => {
    expect(uniqSorted(["b", "a", "b", "c", "a"])).toEqual(["a", "b", "c"]);
  });

  it("returns a new array without mutating the input", () => {
    const input = ["z", "a", "z"];
    const result = uniqSorted(input);
    expect(result).toEqual(["a", "z"]);
    expect(input).toEqual(["z", "a", "z"]);
  });

  it("handles an empty list", () => {
    expect(uniqSorted([])).toEqual([]);
  });
});
