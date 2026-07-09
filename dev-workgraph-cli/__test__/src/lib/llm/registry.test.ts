import { describe, expect, it, vi } from "vitest";
import { createLlmRegistry } from "../../../../src/lib/llm";
import type { LlmProvider, LlmProviderKind } from "../../../../src/lib/llm/types.js";

function mockKind(
  id: LlmProvider["id"],
  models: string[],
  opts?: { accept?: boolean; reachable?: boolean },
): LlmProviderKind {
  const baseUrl = id === "lmstudio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434";
  const provider: LlmProvider = {
    id,
    getName: () => id,
    getBaseUrl: () => baseUrl,
    isReachable: async () => opts?.reachable ?? true,
    getModels: async () => (opts?.reachable === false ? [] : models),
    loadModel: async () => {},
    unloadAll: async () => {},
    chatJson: async () => ({}),
  };
  return {
    id,
    displayName: id,
    defaultBaseUrl: baseUrl,
    cliUrlOption: `--${id}-url <url>`,
    cliUrlDescription: `${id} url`,
    needsStepLifecycle: false,
    create: () => provider,
    resolveUrl: () => baseUrl,
    acceptForDiscovery: async () => opts?.accept ?? true,
    printInstallHelp: () => {},
    printNoModelsHelp: () => {},
  };
}

describe("LlmProviderRegistry", () => {
  it("discovers only reachable providers with models", async () => {
    const registry = createLlmRegistry();
    const discoverSpy = vi
      .spyOn(registry, "get")
      .mockImplementationOnce(() => mockKind("ollama", ["a"]).create("http://127.0.0.1:11434"))
      .mockImplementationOnce(() => mockKind("lmstudio", [], { reachable: false }).create("http://127.0.0.1:1234"));

    const found = await registry.discover();
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("ollama");
    discoverSpy.mockRestore();
  });

  it("listModelChoices sorts by provider then model", async () => {
    const registry = createLlmRegistry();
    vi.spyOn(registry, "discover").mockResolvedValue([
      mockKind("lmstudio", ["z-model"]).create("http://127.0.0.1:1234"),
      mockKind("ollama", ["b-model", "a-model"]).create("http://127.0.0.1:11434"),
    ]);

    await expect(registry.listModelChoices()).resolves.toEqual([
      {
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        model: "z-model",
      },
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "a-model",
      },
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "b-model",
      },
    ]);
  });
});
