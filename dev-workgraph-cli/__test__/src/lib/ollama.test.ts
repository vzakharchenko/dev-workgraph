import { afterEach, describe, expect, it, vi } from "vitest";
import { routineCheckJsonSchema } from "../../../src/lib/model.js";
import { loadConfig } from "../../../src/lib/config.js";
import { chatJson, listModels, resolveBaseUrl } from "../../../src/lib/llm";

vi.mock("../../../src/lib/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

describe("resolveBaseUrl", () => {
  let previousHost: string | undefined;

  afterEach(() => {
    if (previousHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = previousHost;
    delete process.env.WORKGRAPH_OLLAMA_URL;
    vi.mocked(loadConfig).mockReturnValue({});
  });

  it("defaults to localhost when no flag or env is set", () => {
    previousHost = process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_HOST;
    expect(resolveBaseUrl("ollama")).toBe("http://127.0.0.1:11434");
  });

  it("normalizes host:port and strips trailing slashes", () => {
    expect(resolveBaseUrl("ollama", { ollama: "192.168.1.10:11434/" })).toBe(
      "http://192.168.1.10:11434",
    );
  });

  it("prefers the flag over OLLAMA_HOST", () => {
    previousHost = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://env-host:11434";
    expect(resolveBaseUrl("ollama", { ollama: "http://flag-host:11434" })).toBe(
      "http://flag-host:11434",
    );
  });

  it("honors servers.ollama and legacy config baseUrl", () => {
    vi.mocked(loadConfig).mockReturnValue({
      repos: {},
      llm: { servers: { ollama: "http://servers:11434" } },
    });
    expect(resolveBaseUrl("ollama")).toBe("http://servers:11434");

    process.env.WORKGRAPH_OLLAMA_URL = "http://env-ollama:11434";
    expect(resolveBaseUrl("ollama")).toBe("http://servers:11434");

    vi.mocked(loadConfig).mockReturnValue({
      repos: {},
      llm: { provider: "ollama", baseUrl: "http://legacy:11434" },
    });
    delete process.env.WORKGRAPH_OLLAMA_URL;
    delete process.env.OLLAMA_HOST;
    expect(resolveBaseUrl("ollama")).toBe("http://legacy:11434");
  });

  it("createOllamaProvider isReachable handles empty and failing backends", async () => {
    const { createLlmProvider } = await import("../../../src/lib/llm/providers.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) }));
    await expect(createLlmProvider("ollama", "http://127.0.0.1:11434").isReachable()).resolves.toBe(
      false,
    );

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(createLlmProvider("ollama", "http://127.0.0.1:11434").isReachable()).resolves.toBe(
      false,
    );
    vi.unstubAllGlobals();
  });
});

describe("listModels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns model names from /api/tags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "alpha" }, { name: "beta" }] }),
      }),
    );
    await expect(listModels("http://127.0.0.1:11434", "ollama")).resolves.toEqual(["alpha", "beta"]);
  });

  it("throws when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await expect(listModels("http://127.0.0.1:11434", "ollama")).rejects.toThrow(/cannot reach ollama/i);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(listModels("http://127.0.0.1:11434", "ollama")).rejects.toThrow(/503/);
  });
});

describe("chatJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /api/chat and validates JSON content", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"routine": true, "reason": "deps"}' },
        prompt_eval_count: 120,
        eval_count: 30,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
    });
    expect(result).toEqual({ routine: true, reason: "deps" });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("prompt 120"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.options).toEqual({ temperature: 0.2 });
    expect(body.options.num_predict).toBeUndefined();
    expect(body.options.num_ctx).toBeUndefined();
  });

  it("omits think by default (narrativeModel stages)", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"routine": true, "reason": "deps"}' },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("think");
  });

  it("sends think: false when requested (commitModel / reportModel stages)", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"routine": true, "reason": "deps"}' },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
      think: false,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.think).toBe(false);
  });

  it("retries on HTTP failure then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "fail" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '{"routine": false, "reason": "work"}' },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const promise = chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ routine: false, reason: "work" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("accepts valid JSON when done_reason is length", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        done_reason: "length",
        message: { content: '{"routine": true, "reason": "ok"}' },
        prompt_eval_count: 1000,
        eval_count: 500,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      chatJson({
        baseUrl: "http://127.0.0.1:11434",
        model: "test",
        system: "sys",
        user: "user",
        provider: "ollama",
      schema: routineCheckJsonSchema(),
      }),
    ).resolves.toEqual({ routine: true, reason: "ok" });
    expect(stderr).toHaveBeenCalledWith(
      "   warning: Ollama done_reason=length but response validated OK\n",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on invalid JSON then succeeds", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          done_reason: "length",
          message: { content: '{"routine":' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '{"routine": true, "reason": "ok"}' },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const promise = chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ routine: true, reason: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries on empty content then succeeds", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          done_reason: "length",
          message: { content: "" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '{"routine": true, "reason": "ok"}' },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const promise = chatJson({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      system: "sys",
      user: "user",
      provider: "ollama",
      schema: routineCheckJsonSchema(),
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ routine: true, reason: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
