import { describe, expect, it } from "vitest";
import { Command } from "commander";
import {
  pickLlmCommandOptions,
  registerLlmProviderOptions,
} from "../../../../src/lib/llm/cli-options.js";

describe("cli-options", () => {
  it("registerLlmProviderOptions adds per-provider URL flags", () => {
    const cmd = registerLlmProviderOptions(new Command("test"));
    const optionFlags = cmd.options.map((o) => o.flags);
    expect(optionFlags).toContain("--ollama-url <url>");
    expect(optionFlags).toContain("--lmstudio-url <url>");
  });

  it("pickLlmCommandOptions maps commander fields and model", () => {
    expect(
      pickLlmCommandOptions({
        ollamaUrl: "http://ollama:11434",
        model: "test-model",
      }),
    ).toEqual({
      ollama: "http://ollama:11434",
      model: "test-model",
    });
    expect(pickLlmCommandOptions({})).toEqual({});
  });
});
