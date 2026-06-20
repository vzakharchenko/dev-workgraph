import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check, ollamaReady } from "../../src/actions/check.js";
import * as config from "../../src/lib/config.js";
import * as ollama from "../../src/lib/ollama.js";

describe("ollamaReady", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when models are available", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha"]);
    await expect(ollamaReady("http://127.0.0.1:11434")).resolves.toBe(true);
  });

  it("returns false when the server is unreachable", async () => {
    vi.spyOn(ollama, "listModels").mockRejectedValue(new Error("connection refused"));
    await expect(ollamaReady("http://127.0.0.1:11434")).resolves.toBe(false);
  });

  it("returns false when no models are installed", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue([]);
    await expect(ollamaReady("http://127.0.0.1:11434")).resolves.toBe(false);
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
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha"]);
    vi.spyOn(config, "loadConfig").mockReturnValue({
      repos: {},
      ollama: { commitModel: "missing-model", reportModel: "alpha" },
    });
    await check({});
    expect(process.exitCode).toBe(1);
  });

  it("passes when saved models are installed", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta"]);
    vi.spyOn(config, "loadConfig").mockReturnValue({
      repos: {},
      ollama: { commitModel: "alpha", reportModel: "beta" },
    });
    await check({});
    expect(process.exitCode).toBeUndefined();
  });
});
