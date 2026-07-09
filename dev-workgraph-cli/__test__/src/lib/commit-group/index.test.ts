import { describe, expect, it } from "vitest";
import {
  getCommitGroupStrategy,
  pickCommitGroupStrategyOptions,
  registerCommitGroupStrategyOptions,
} from "../../../../src/lib/commit-group/index.js";

describe("commit-group index", () => {
  it("re-exports registry and cli helpers", () => {
    expect(getCommitGroupStrategy("day-gap").id).toBe("day-gap");
    expect(pickCommitGroupStrategyOptions(undefined, { days: 1 })).toEqual({ days: 1 });
    expect(registerCommitGroupStrategyOptions).toBeTypeOf("function");
  });
});
