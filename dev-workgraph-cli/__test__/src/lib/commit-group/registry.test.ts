import { describe, expect, it } from "vitest";
import {
  defaultCommitGroupStrategy,
  getCommitGroupStrategy,
  listCommitGroupStrategies,
} from "../../../../src/lib/commit-group/registry.js";

describe("commit-group registry", () => {
  it("listCommitGroupStrategies includes day-gap", () => {
    const strategies = listCommitGroupStrategies();
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.map((s) => s.id)).toContain("day-gap");
  });

  it("defaultCommitGroupStrategy returns the first registered strategy", () => {
    const strategy = defaultCommitGroupStrategy();
    expect(strategy.id).toBe("day-gap");
    expect(strategy.displayName).toContain("day gap");
  });

  it("getCommitGroupStrategy without id returns the default", () => {
    expect(getCommitGroupStrategy().id).toBe(defaultCommitGroupStrategy().id);
  });

  it("getCommitGroupStrategy resolves a known id", () => {
    expect(getCommitGroupStrategy("day-gap").id).toBe("day-gap");
  });

  it("getCommitGroupStrategy throws for an unknown id", () => {
    expect(() => getCommitGroupStrategy("jira")).toThrow(
      'Unknown commit-group strategy "jira". Use day-gap.',
    );
  });
});
