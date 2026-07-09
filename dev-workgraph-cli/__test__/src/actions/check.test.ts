import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check, llmReady } from "../../../src/actions/check.js";
import * as config from "../../../src/lib/config.js";
import * as providers from "../../../src/lib/llm/providers.js";
import * as ollama from "../../../src/lib/ollama.js";

describe("llmReady", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when models are available", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha"]);
    await expect(llmReady("http://127.0.0.1:11434")).resolves.toBe(true);
  });

  it("returns false when the server is unreachable", async () => {
    vi.spyOn(ollama, "listModels").mockRejectedValue(new Error("connection refused"));
    await expect(llmReady("http://127.0.0.1:11434")).resolves.toBe(false);
  });

  it("returns false when no models are installed", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue([]);
    await expect(llmReady("http://127.0.0.1:11434")).resolves.toBe(false);
  });

  it("suggests ollama serve when the binary is installed but the server is down", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(ollama, "listModels").mockRejectedValue(new Error("connection refused"));
    const kind = providers.getProviderKind("ollama");
    vi.spyOn(providers, "getProviderKind").mockReturnValue({
      ...kind,
      isBinaryInstalled: () => true,
    });
    await expect(llmReady("http://127.0.0.1:11434", "ollama")).resolves.toBe(false);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("ollama serve");
  });
});

describe("check", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  beforeEach(() => {
    process.exitCode = undefined;
  });

  it("reports missing saved models", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        models: ["alpha", "beta", "gamma"],
      },
    ]);
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta", "gamma"]);
    vi.spyOn(config, "loadConfig").mockReturnValue({
      repos: {},
      llm: {
        commit: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "missing-model" },
        report: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "alpha" },
        narrative: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "beta" },
      },
    });
    await check({});
    expect(process.exitCode).toBe(1);
  });

  it("passes when saved models are installed", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        models: ["alpha", "beta", "gamma"],
      },
    ]);
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta", "gamma"]);
    vi.spyOn(config, "loadConfig").mockReturnValue({
      repos: {},
      llm: {
        commit: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "alpha" },
        report: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "beta" },
        narrative: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "gamma" },
      },
    });
    await check({});
    expect(process.exitCode).toBeUndefined();
  });

  it("prints install help when no backends are reachable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([]);
    await check({});
    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("How to install Ollama");
  });

  it("llmReady reports empty model list via provider help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(ollama, "listModels").mockResolvedValue([]);
    await expect(llmReady("http://127.0.0.1:1234", "lmstudio")).resolves.toBe(false);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain("no models are available");
  });
});
