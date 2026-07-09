import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupWorkgraphHome } from "../helpers/action-fixtures.js";
import * as ollama from "../../../src/lib/ollama.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

import { resolveLlmSlot, resolveLlmWithModel, resolveModel } from "../../../src/lib/select.js";

describe("resolveModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    promptMock.mockReset();
  });

  it("returns the flag model when it exists on the server", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta"]);
    await expect(resolveModel("http://127.0.0.1:11434", "beta")).resolves.toBe("beta");
  });

  it("throws when the flag model is missing", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha"]);
    await expect(resolveModel("http://127.0.0.1:11434", "missing")).rejects.toThrow(
      /not found/i,
    );
  });

  it("throws when the server has no models", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue([]);
    await expect(resolveModel("http://127.0.0.1:11434", "alpha", { providerId: "ollama" })).rejects.toThrow(
      /no models installed/i,
    );
    await expect(
      resolveModel("http://127.0.0.1:1234", "alpha", { providerId: "lmstudio" }),
    ).rejects.toThrow(/no models available on lm studio/i);
  });

  it("prompts interactively when no flag is given", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta"]);
    promptMock.mockResolvedValue({ model: "beta" });
    await expect(
      resolveModel("http://127.0.0.1:11434", undefined, { saved: "alpha" }),
    ).resolves.toBe("beta");
    expect(promptMock).toHaveBeenCalledOnce();
  });

  it("defaults to the first model when saved choice is unavailable", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta"]);
    promptMock.mockResolvedValue({ model: "alpha" });
    await expect(
      resolveModel("http://127.0.0.1:11434", undefined, {
        saved: "removed",
        message: "Pick model",
      }),
    ).resolves.toBe("alpha");
    const call = promptMock.mock.calls[0]?.[0] as [{ default?: string }];
    expect(call[0]?.default).toBe("alpha");
  });
});

describe("resolveLlmWithModel", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
    vi.restoreAllMocks();
    promptMock.mockReset();
  });

  it("resolves an unambiguous --model without prompting", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      {
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        models: ["alpha"],
      },
    ]);
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      get: vi.fn(),
      discover: vi.fn(),
      listModelChoices: async () => [
        {
          providerId: "lmstudio",
          baseUrl: "http://127.0.0.1:1234",
          model: "alpha",
        },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    await expect(resolveLlmWithModel({ model: "alpha" })).resolves.toEqual({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "alpha",
    });
  });

  it("merges models from multiple backends into one picker", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        models: ["ollama-model"],
      },
      {
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        models: ["studio-model"],
      },
    ]);
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      get: vi.fn(),
      discover: vi.fn(),
      listModelChoices: async () => [
        {
          providerId: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          model: "ollama-model",
        },
        {
          providerId: "lmstudio",
          baseUrl: "http://127.0.0.1:1234",
          model: "studio-model",
        },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    const lmPick = {
      providerId: "lmstudio" as const,
      baseUrl: "http://127.0.0.1:1234",
      model: "studio-model",
    };
    promptMock.mockResolvedValue({ pick: lmPick });
    await expect(resolveLlmWithModel({ message: "Pick one" })).resolves.toEqual(lmPick);
    expect(promptMock).toHaveBeenCalledOnce();
  });

  it("throws when no backend is reachable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([]);
    await expect(resolveLlmWithModel()).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No LLM backend"));
  });

  it("throws when --model is missing from all backends", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", models: ["alpha"] },
    ]);
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      listModelChoices: async () => [
        { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", model: "alpha" },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    await expect(resolveLlmWithModel({ model: "missing" })).rejects.toThrow(/not found/i);
  });

  it("auto-picks the only available model", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", models: ["only"] },
    ]);
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      listModelChoices: async () => [
        { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", model: "only" },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    await expect(resolveLlmWithModel()).resolves.toEqual({
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "only",
    });
  });

  it("prompts when the same model name exists on multiple backends", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", models: ["shared"] },
      { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", models: ["shared"] },
    ]);
    const studioPick = {
      providerId: "lmstudio" as const,
      baseUrl: "http://127.0.0.1:1234",
      model: "shared",
    };
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      listModelChoices: async () => [
        { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", model: "shared" },
        studioPick,
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    promptMock.mockResolvedValue({ pick: studioPick });

    await expect(
      resolveLlmWithModel({
        model: "shared",
        saved: "shared",
        savedProvider: "ollama",
      }),
    ).resolves.toEqual(studioPick);
    expect(promptMock).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Ollama @"));
  });

  it("seeds the picker with saved provider when model names collide", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", models: ["m"] },
      { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", models: ["m"] },
    ]);
    const ollamaPick = {
      providerId: "ollama" as const,
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
    };
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      listModelChoices: async () => [
        ollamaPick,
        { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", model: "m" },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);
    promptMock.mockResolvedValue({ pick: ollamaPick });

    await resolveLlmWithModel({ saved: "m", savedProvider: "ollama" });
    const promptConfig = promptMock.mock.calls[0]?.[0] as [{ default?: { providerId: string } }];
    expect(promptConfig[0]?.default?.providerId).toBe("ollama");
  });
});

describe("resolveLlmSlot", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
    vi.restoreAllMocks();
  });

  it("persists the resolved choice for the slot", async () => {
    vi.spyOn(ollama, "discoverLlmBackends").mockResolvedValue([
      { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", models: ["studio-m"] },
    ]);
    vi.spyOn(ollama, "createLlmRegistry").mockReturnValue({
      listModelChoices: async () => [
        { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", model: "studio-m" },
      ],
    } as unknown as ReturnType<typeof ollama.createLlmRegistry>);

    await expect(resolveLlmSlot("report", { model: "studio-m" })).resolves.toEqual({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "studio-m",
    });

    const { loadConfig } = await import("../../../src/lib/config.js");
    expect(loadConfig().llm?.report?.model).toBe("studio-m");
  });
});
