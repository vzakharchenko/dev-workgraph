import { afterEach, describe, expect, it, vi } from "vitest";
import * as ollama from "../../src/lib/ollama.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

import { resolveModel } from "../../src/lib/select.js";

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
    await expect(resolveModel("http://127.0.0.1:11434", "alpha")).rejects.toThrow(
      /no models installed/i,
    );
  });

  it("prompts interactively when no flag is given", async () => {
    vi.spyOn(ollama, "listModels").mockResolvedValue(["alpha", "beta"]);
    promptMock.mockResolvedValue({ model: "beta" });
    await expect(
      resolveModel("http://127.0.0.1:11434", undefined, { saved: "alpha" }),
    ).resolves.toBe("beta");
    expect(promptMock).toHaveBeenCalledOnce();
  });
});
