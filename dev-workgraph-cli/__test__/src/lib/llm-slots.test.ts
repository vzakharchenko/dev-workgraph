import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type LlmConfig } from "../../../src/lib/config.js";
import {
  getLlmSlot,
  saveLlmSlot,
  savedSeedForSlot,
  slotMessage,
} from "../../../src/lib/llm-slots.js";
import { setupWorkgraphHome } from "../helpers/action-fixtures.js";
import { resolveBaseUrl } from "../../../src/lib/llm";

describe("getLlmSlot baseUrl", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
  });

  it("does not reuse Ollama baseUrl for an LM Studio slot", () => {
    const cfg: LlmConfig = {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      commit: { provider: "lmstudio", model: "studio-model", baseUrl: "http://127.0.0.1:1234" },
    };
    expect(getLlmSlot(cfg, "commit")?.baseUrl).toBe("http://127.0.0.1:1234");
  });

  it("uses stored baseUrl for an LM Studio slot as-is", () => {
    const cfg: LlmConfig = {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      reportModel: "report-model",
      report: { provider: "lmstudio", model: "studio-model", baseUrl: "http://127.0.0.1:1234" },
    };
    const slot = getLlmSlot(cfg, "report");
    expect(slot?.provider).toBe("lmstudio");
    expect(slot?.baseUrl).toBe("http://127.0.0.1:1234");
  });

  it("reuses global baseUrl when provider matches", () => {
    const cfg: LlmConfig = {
      provider: "ollama",
      baseUrl: "http://custom:11434",
      commitModel: "m",
    };
    expect(getLlmSlot(cfg, "commit")?.baseUrl).toBe("http://custom:11434");
  });

  it("returns undefined when no model is configured", () => {
    expect(getLlmSlot(undefined, "commit")).toBeUndefined();
    expect(getLlmSlot({}, "report")).toBeUndefined();
  });

  it("falls back through legacy narrative model fields", () => {
    const cfg: LlmConfig = {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      narrativeModel: "narrative-m",
    };
    expect(getLlmSlot(cfg, "narrative")).toEqual({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "narrative-m",
    });
  });

  it("uses reportModel fallback for report slot", () => {
    const cfg: LlmConfig = { reportModel: "report-m", model: "legacy" };
    expect(getLlmSlot(cfg, "report")?.model).toBe("report-m");
  });
});

describe("savedSeedForSlot", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
  });

  it("returns the primary slot when configured", () => {
    const cfg: LlmConfig = {
      commit: { provider: "lmstudio", baseUrl: "http://127.0.0.1:1234", model: "studio-m" },
    };
    expect(savedSeedForSlot("commit", cfg)).toEqual({
      saved: "studio-m",
      savedProvider: "lmstudio",
    });
  });

  it("falls back from narrative to report slot", () => {
    const cfg: LlmConfig = {
      report: { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "report-m" },
    };
    expect(savedSeedForSlot("narrative", cfg)).toEqual({
      saved: "report-m",
      savedProvider: "ollama",
    });
  });

  it("falls back to legacy flat model from disk config", () => {
    saveLlmSlot("report", {
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "saved-model",
    });
    expect(savedSeedForSlot("narrative")).toEqual({
      saved: "saved-model",
      savedProvider: "ollama",
    });
  });
});

describe("saveLlmSlot", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
  });

  it("persists nested slot and legacy model fields per stage", () => {
    saveLlmSlot("commit", {
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "studio-model",
    });
    saveLlmSlot("report", {
      providerId: "ollama",
      baseUrl: "http://custom:11434",
      model: "report-model",
    });
    saveLlmSlot("narrative", {
      providerId: "ollama",
      baseUrl: "http://custom:11434",
      model: "narrative-model",
    });

    const cfg = loadConfig().llm;
    expect(cfg?.commit).toEqual({
      provider: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      model: "studio-model",
    });
    expect(cfg?.commitModel).toBe("studio-model");
    expect(cfg?.reportModel).toBe("report-model");
    expect(cfg?.narrativeModel).toBe("narrative-model");
  });
});

describe("slotMessage", () => {
  it("returns defaults and honors overrides", () => {
    expect(slotMessage("commit")).toContain("commit summaries");
    expect(slotMessage("report", "Custom?")).toBe("Custom?");
  });
});

describe("resolveBaseUrl provider defaults", () => {
  let restoreHome: () => void;

  beforeEach(() => {
    ({ restore: restoreHome } = setupWorkgraphHome());
  });

  afterEach(() => {
    restoreHome();
    delete process.env.WORKGRAPH_LLM_URL;
    delete process.env.LM_STUDIO_BASE_URL;
  });

  it("uses port 1234 for lmstudio by default", () => {
    expect(resolveBaseUrl("lmstudio")).toBe("http://127.0.0.1:1234");
  });

  it("does not apply WORKGRAPH_LLM_URL (Ollama) to lmstudio", () => {
    process.env.WORKGRAPH_LLM_URL = "http://127.0.0.1:11434";
    expect(resolveBaseUrl("lmstudio")).toBe("http://127.0.0.1:1234");
  });

  it("honors LM_STUDIO_BASE_URL for lmstudio", () => {
    process.env.LM_STUDIO_BASE_URL = "http://192.168.1.5:1234";
    expect(resolveBaseUrl("lmstudio")).toBe("http://192.168.1.5:1234");
  });
});
