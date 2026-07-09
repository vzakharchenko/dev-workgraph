import { describe, expect, it, vi } from "vitest";
import { noLlmBackendsError, printNoLlmBackendsHelp } from "../../../../src/lib/llm/install-help.js";

describe("install-help", () => {
  it("prints provider install instructions and flag hints", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printNoLlmBackendsHelp();
    const output = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("No LLM backend is reachable");
    expect(output).toContain("How to install Ollama");
    expect(output).toContain("How to use LM Studio");
    expect(output).toContain("--ollama-url");
    expect(output).toContain("--lmstudio-url");
  });

  it("noLlmBackendsError prints help and returns an empty error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = noLlmBackendsError();
    expect(err.message).toBe("");
    expect(log).toHaveBeenCalled();
  });
});
