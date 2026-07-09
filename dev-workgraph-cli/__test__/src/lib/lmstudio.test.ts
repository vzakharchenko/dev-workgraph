import { afterEach, describe, expect, it, vi } from "vitest";
import { routineCheckJsonSchema } from "../../../src/lib/model.js";
import { loadConfig } from "../../../src/lib/config.js";
import { discoverLlmBackends, resolveBaseUrl, resolveProviderId } from "../../../src/lib/llm";
import * as providers from "../../../src/lib/llm/providers.js";
import {
  createLmStudioProvider,
  isLmStudioNativeApi,
  isOllamaDefaultPort,
  LM_STUDIO_CONTEXT_LENGTH,
  normalizeLmStudioBaseUrl,
  prepareLmStudioStep,
  releaseLmStudioStep,
  resetLmStudioLoadCache,
  resolveLmStudioDiscoveryUrl,
  unloadAllLmStudioModels,
} from "../../../src/lib/llm/lmstudio.js";
import { withProviderStep } from "../../../src/lib/lmstudio-session.js";

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

function mockLmStudioLoadOk(): Response {
  return {
    ok: true,
    json: async () => ({ status: "loaded" }),
  } as Response;
}

function isLmStudioLoadUrl(url: string | URL): boolean {
  return String(url).includes("/api/v1/models/load");
}

function isLmStudioUnloadUrl(url: string | URL): boolean {
  return String(url).includes("/api/v1/models/unload");
}

function isLmStudioNativeListUrl(url: string | URL): boolean {
  const s = String(url);
  return s.includes("/api/v1/models") && !s.includes("/load") && !s.includes("/unload");
}

vi.mock("inquirer", () => ({
  default: { prompt: promptMock },
}));

vi.mock("../../../src/lib/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

describe("lmstudio URL helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(loadConfig).mockReturnValue({ repos: {} });
    delete process.env.LM_STUDIO_BASE_URL;
  });

  it("detects Ollama default port misconfiguration", () => {
    expect(isOllamaDefaultPort("http://127.0.0.1:11434")).toBe(true);
    expect(isOllamaDefaultPort("127.0.0.1:11434")).toBe(true);
    expect(isOllamaDefaultPort("http://127.0.0.1:1234")).toBe(false);
    expect(normalizeLmStudioBaseUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:1234");
  });

  it("probes native LM Studio API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false }),
    );
    await expect(isLmStudioNativeApi("http://127.0.0.1:1234")).resolves.toBe(true);
    await expect(isLmStudioNativeApi("http://127.0.0.1:1234")).resolves.toBe(false);
  });

  it("resolveLmStudioDiscoveryUrl skips Ollama port candidates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(resolveLmStudioDiscoveryUrl("http://127.0.0.1:11434")).resolves.toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }),
    );
    await expect(resolveLmStudioDiscoveryUrl("http://127.0.0.1:1234")).resolves.toBe(
      "http://127.0.0.1:1234",
    );
  });

  it("resolveBaseUrl honors servers.lmstudio and legacy provider baseUrl", () => {
    vi.mocked(loadConfig).mockReturnValue({
      repos: {},
      llm: {
        provider: "lmstudio",
        baseUrl: "http://legacy:1234",
        servers: { lmstudio: "http://servers:1234" },
      },
    });
    expect(resolveBaseUrl("lmstudio")).toBe("http://servers:1234");
    vi.mocked(loadConfig).mockReturnValue({
      repos: {},
      llm: { provider: "lmstudio", baseUrl: "http://legacy:1234" },
    });
    expect(resolveBaseUrl("lmstudio")).toBe("http://legacy:1234");
    vi.mocked(loadConfig).mockReturnValue({
      repos: {},
      llm: { provider: "lmstudio", baseUrl: "http://127.0.0.1:11434" },
    });
    expect(resolveBaseUrl("lmstudio")).toBe("http://127.0.0.1:1234");
  });
});

describe("resolveProviderId", () => {
  it("defaults to ollama", () => {
    expect(resolveProviderId()).toBe("ollama");
  });

  it("accepts lmstudio aliases", () => {
    expect(resolveProviderId("lm-studio")).toBe("lmstudio");
  });
});

describe("discoverLlmBackends", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns only reachable backends with models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        if (String(url).includes("11434")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ name: "alpha" }] }),
          });
        }
        return Promise.reject(new Error("connection refused"));
      }),
    );
    await expect(discoverLlmBackends()).resolves.toEqual([
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        models: ["alpha"],
      },
    ]);
  });

  it("discovers LM Studio when native API and models respond", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = String(url);
        if (u.includes("/api/v1/models")) {
          return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
        }
        if (u.includes("/v1/models")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ id: "studio-model" }] }),
          });
        }
        if (u.includes("/api/tags")) {
          return Promise.reject(new Error("connection refused"));
        }
        return Promise.reject(new Error(`unexpected ${u}`));
      }),
    );
    await expect(discoverLlmBackends()).resolves.toEqual([
      {
        providerId: "lmstudio",
        baseUrl: "http://127.0.0.1:1234",
        models: ["studio-model"],
      },
    ]);
  });

  it("uses per-provider URLs when probing both backends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = String(url);
        if (u.includes("11434") && u.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ name: "ollama-model" }] }),
          });
        }
        if (u.includes("11434") && u.includes("/api/v1/models")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (u.includes("1234") && u.includes("/api/v1/models")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ loaded_instances: [] }] }),
          });
        }
        if (u.includes("1234") && u.includes("/v1/models")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ id: "studio-model" }] }),
          });
        }
        return Promise.reject(new Error(`unexpected ${u}`));
      }),
    );
    await expect(discoverLlmBackends({ ollama: "http://127.0.0.1:11434" })).resolves.toEqual([
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
  });

  it("does not register LM Studio on Ollama port when native API is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = String(url);
        if (u.includes("/api/tags")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ models: [{ name: "only-ollama" }] }),
          });
        }
        if (u.includes("/api/v1/models")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (u.includes("/v1/models")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ id: "only-ollama" }] }),
          });
        }
        return Promise.reject(new Error(`unexpected ${u}`));
      }),
    );
    await expect(discoverLlmBackends()).resolves.toEqual([
      {
        providerId: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        models: ["only-ollama"],
      },
    ]);
  });
});

describe("resolveBaseUrl for lmstudio", () => {
  it("defaults to port 1234", () => {
    expect(resolveBaseUrl("lmstudio")).toBe("http://127.0.0.1:1234");
  });
});

describe("lmstudio session lifecycle", () => {
  afterEach(() => {
    resetLmStudioLoadCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("unloads every loaded instance from the native models API", async () => {
    const unloads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        if (isLmStudioNativeListUrl(url)) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [
                { loaded_instances: [{ id: "model-a" }, { id: "model-b" }] },
                { loaded_instances: [] },
              ],
            }),
          });
        }
        if (isLmStudioUnloadUrl(url)) {
          const body = JSON.parse(String(init?.body)) as { instance_id: string };
          unloads.push(body.instance_id);
          return Promise.resolve({ ok: true, json: async () => ({ instance_id: body.instance_id }) });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );

    await unloadAllLmStudioModels("http://127.0.0.1:1234");

    expect(unloads).toEqual(["model-a", "model-b"]);
  });

  it("prepare unloads all then loads the step model", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (isLmStudioNativeListUrl(u)) {
          calls.push("list");
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [{ loaded_instances: [{ id: "old-model" }] }],
            }),
          });
        }
        if (isLmStudioUnloadUrl(u)) {
          calls.push("unload");
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (isLmStudioLoadUrl(u)) {
          calls.push("load");
          return Promise.resolve(mockLmStudioLoadOk());
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );

    await prepareLmStudioStep("http://127.0.0.1:1234", "step-model");

    expect(calls).toEqual(["list", "unload", "load"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unloading all models"));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("loading step-model"),
    );
  });

  it("release unloads all models and clears the load cache", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        if (isLmStudioNativeListUrl(url)) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [{ loaded_instances: [{ id: "loaded-model" }] }],
            }),
          });
        }
        if (isLmStudioUnloadUrl(url)) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }),
    );

    await releaseLmStudioStep("http://127.0.0.1:1234");
    await releaseLmStudioStep("http://127.0.0.1:1234");

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("withProviderStep prepares and releases only for lmstudio slots", async () => {
    const prepareSpy = vi.fn().mockResolvedValue(undefined);
    const releaseSpy = vi.fn().mockResolvedValue(undefined);
    const realGet = providers.getProviderKind;
    vi.spyOn(providers, "getProviderKind").mockImplementation((id) => {
      const kind = realGet(id);
      if (id === "lmstudio") {
        return { ...kind, prepareStep: prepareSpy, releaseStep: releaseSpy };
      }
      return kind;
    });

    await withProviderStep(
      { providerId: "lmstudio", baseUrl: "http://127.0.0.1:1234", model: "m1" },
      async () => "done",
    );
    expect(prepareSpy).toHaveBeenCalledOnce();
    expect(releaseSpy).toHaveBeenCalledOnce();

    prepareSpy.mockClear();
    releaseSpy.mockClear();
    await withProviderStep(
      { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", model: "m1" },
      async () => "done",
    );
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });
});

describe("createLmStudioProvider", () => {
  const baseUrl = "http://127.0.0.1:1234";

  afterEach(() => {
    resetLmStudioLoadCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists models from /v1/models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "local-model" }] }),
      }),
    );
    await expect(createLmStudioProvider(baseUrl).getModels()).resolves.toEqual([
      "local-model",
    ]);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/models");
  });

  it("loads the model with 32k context before chat", async () => {
    expect(LM_STUDIO_CONTEXT_LENGTH).toBe(32_768);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      if (isLmStudioLoadUrl(url)) {
        return Promise.resolve(mockLmStudioLoadOk());
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"routine": true, "reason": "deps"}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLmStudioProvider(baseUrl).chatJson({
      model: "local-model",
      system: "sys",
      user: "user",
      schema: routineCheckJsonSchema(),
      think: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:1234/api/v1/models/load",
    );
    const loadBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(loadBody).toEqual({
      model: "local-model",
      context_length: 32_768,
    });
    const chatBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(chatBody.response_format.type).toBe("json_schema");
  });

  it("posts to /v1/chat/completions with json_schema format", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn((url: string | URL) => {
      if (isLmStudioLoadUrl(url)) {
        return Promise.resolve(mockLmStudioLoadOk());
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"routine": true, "reason": "deps"}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLmStudioProvider(baseUrl).chatJson({
      model: "local-model",
      system: "sys",
      user: "user",
      schema: routineCheckJsonSchema(),
      think: false,
    });

    expect(result).toEqual({ routine: true, reason: "deps" });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body).not.toHaveProperty("think");
  });

  it("falls back from strict json_schema to plain text on 400", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let chatCalls = 0;
    const fetchMock = vi.fn((url: string | URL) => {
      if (isLmStudioLoadUrl(url)) {
        return Promise.resolve(mockLmStudioLoadOk());
      }
      chatCalls += 1;
      if (chatCalls === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: async () => '{"error":"schema too complex for strict json_schema"}',
        });
      }
      if (chatCalls === 2) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: async () => '{"error":"still rejected"}',
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"routine": false, "reason": "big diff"}' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLmStudioProvider(baseUrl).chatJson({
      model: "local-model",
      system: "sys",
      user: "user",
      schema: routineCheckJsonSchema(),
      think: false,
    });

    expect(result).toEqual({ routine: false, reason: "big diff" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const strictBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const relaxedBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    const textBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(strictBody.response_format.json_schema.strict).toBe(true);
    expect(relaxedBody.response_format.json_schema.strict).toBe(false);
    expect(textBody).not.toHaveProperty("response_format");
  });

  it("isReachable returns false without native API or models", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(createLmStudioProvider(baseUrl).isReachable()).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        if (isLmStudioNativeListUrl(url)) {
          return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );
    await expect(createLmStudioProvider(baseUrl).isReachable()).resolves.toBe(false);
  });

  it("isReachable returns true when native API and models respond", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        if (isLmStudioNativeListUrl(url)) {
          return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: "local-model" }] }),
        });
      }),
    );
    await expect(createLmStudioProvider(baseUrl).isReachable()).resolves.toBe(true);
  });

  it("throws when model listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(createLmStudioProvider(baseUrl).getModels()).rejects.toThrow(/cannot reach lm studio/i);
  });

  it("falls back on 422 schema rejection", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let chatCalls = 0;
    const fetchMock = vi.fn((url: string | URL) => {
      if (isLmStudioLoadUrl(url)) return Promise.resolve(mockLmStudioLoadOk());
      chatCalls += 1;
      if (chatCalls === 1) {
        return Promise.resolve({ ok: false, status: 422, text: async () => "bad schema" });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"routine": true, "reason": "ok"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createLmStudioProvider(baseUrl).chatJson({
        model: "local-model",
        system: "sys",
        user: "user",
        schema: routineCheckJsonSchema(),
      }),
    ).resolves.toEqual({ routine: true, reason: "ok" });
  });

  it("unloads listed native instances best-effort", async () => {
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      if (isLmStudioNativeListUrl(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ loaded_instances: [{ id: "inst-1" }, { id: "inst-2" }] }],
          }),
        });
      }
      if (isLmStudioUnloadUrl(url)) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    await unloadAllLmStudioModels(baseUrl);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
