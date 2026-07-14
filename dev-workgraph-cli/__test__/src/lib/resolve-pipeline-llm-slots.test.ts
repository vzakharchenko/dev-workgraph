// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const { discoverLlmBackendsMock, noLlmBackendsErrorMock, resolveLlmSlotMock } = vi.hoisted(() => ({
  discoverLlmBackendsMock: vi.fn(),
  noLlmBackendsErrorMock: vi.fn(() => new Error("no LLM backends")),
  resolveLlmSlotMock: vi.fn(),
}));

vi.mock("../../../src/lib/ollama.js", () => ({
  discoverLlmBackends: discoverLlmBackendsMock,
  noLlmBackendsError: noLlmBackendsErrorMock,
}));

vi.mock("../../../src/lib/select.js", () => ({
  resolveLlmSlot: resolveLlmSlotMock,
}));

import { resolvePipelineLlmSlots } from "../../../src/lib/resolve-pipeline-llm-slots.js";

describe("resolvePipelineLlmSlots", () => {
  beforeEach(() => {
    discoverLlmBackendsMock.mockReset();
    resolveLlmSlotMock.mockReset();
    noLlmBackendsErrorMock.mockClear();
    const choice = {
      providerId: "ollama" as const,
      baseUrl: "http://127.0.0.1:11434",
      model: "test-model",
    };
    resolveLlmSlotMock.mockResolvedValue(choice);
  });

  it("throws when no LLM backends are available", async () => {
    discoverLlmBackendsMock.mockResolvedValue([]);
    await expect(resolvePipelineLlmSlots({ repo: "." })).rejects.toThrow("no LLM backends");
    expect(noLlmBackendsErrorMock).toHaveBeenCalled();
  });

  it("resolves commit, report, and narrative slots", async () => {
    discoverLlmBackendsMock.mockResolvedValue([
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", models: ["test-model"] },
    ]);
    const slots = await resolvePipelineLlmSlots({ repo: ".", model: " test-model " });
    expect(slots.commit.model).toBe("test-model");
    expect(slots.report.model).toBe("test-model");
    expect(slots.narrative.model).toBe("test-model");
    expect(resolveLlmSlotMock).toHaveBeenCalledTimes(3);
    expect(discoverLlmBackendsMock).toHaveBeenCalledWith({
      ollama: undefined,
      lmstudio: undefined,
      model: "test-model",
    });
  });
});
