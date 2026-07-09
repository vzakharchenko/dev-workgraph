import { describe, expect, it } from "vitest";
import {
  createLlmProvider,
  defaultProviderId,
  getProviderKind,
  normalizeProviderId,
  pickLlmUrlOverrides,
  providerDisplayName,
  resolveServerUrl,
} from "../../../../src/lib/llm/providers.js";

describe("providers", () => {
  it("defaultProviderId returns the first registered kind", () => {
    expect(defaultProviderId()).toBe("ollama");
  });

  it("normalizeProviderId accepts ids and aliases", () => {
    expect(normalizeProviderId("ollama")).toBe("ollama");
    expect(normalizeProviderId("LM-STUDIO")).toBe("lmstudio");
    expect(normalizeProviderId()).toBeUndefined();
    expect(normalizeProviderId("  ")).toBeUndefined();
  });

  it("normalizeProviderId rejects unknown backends", () => {
    expect(() => normalizeProviderId("unknown")).toThrow(/unknown llm provider/i);
  });

  it("getProviderKind throws for unknown ids", () => {
    expect(() => getProviderKind("unknown" as "ollama")).toThrow(/unknown llm provider/i);
  });

  it("providerDisplayName resolves registered kinds", () => {
    expect(providerDisplayName("ollama")).toBe("Ollama");
    expect(providerDisplayName("lmstudio")).toBe("LM Studio");
  });

  it("pickLlmUrlOverrides maps commander fields to provider keys", () => {
    expect(
      pickLlmUrlOverrides({
        ollamaUrl: " http://ollama:11434 ",
        lmstudioUrl: "http://studio:1234",
        other: 1,
      }),
    ).toEqual({
      ollama: "http://ollama:11434",
      lmstudio: "http://studio:1234",
    });
    expect(pickLlmUrlOverrides({ ollamaUrl: "  ", lmstudioUrl: "" })).toEqual({});
  });

  it("resolveServerUrl and createLlmProvider delegate to kinds", () => {
    expect(resolveServerUrl("ollama")).toBe("http://127.0.0.1:11434");
    expect(createLlmProvider("ollama", "http://custom:11434").getBaseUrl()).toBe(
      "http://custom:11434",
    );
  });
});
