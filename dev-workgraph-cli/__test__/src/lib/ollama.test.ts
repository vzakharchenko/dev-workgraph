import { afterEach, describe, expect, it, vi } from "vitest";
import { routineCheckJsonSchema } from "../../../src/lib/model.js";
import { chatJson, listModels, resolveBaseUrl } from "../../../src/lib/ollama.js";

describe("resolveBaseUrl", () => {
  let previousHost: string | undefined;

  afterEach(() => {
    if (previousHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = previousHost;
  });

  it("defaults to localhost when no flag or env is set", () => {
    previousHost = process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_HOST;
    expect(resolveBaseUrl()).toBe("http://127.0.0.1:11434");
  });

  it("normalizes host:port and strips trailing slashes", () => {
    expect(resolveBaseUrl("192.168.1.10:11434/")).toBe("http://192.168.1.10:11434");
  });

  it("prefers the flag over OLLAMA_HOST", () => {
    previousHost = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://env-host:11434";
    expect(resolveBaseUrl("http://flag-host:11434")).toBe("http://flag-host:11434");
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
    await expect(listModels("http://127.0.0.1:11434")).resolves.toEqual(["alpha", "beta"]);
  });

  it("throws when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await expect(listModels("http://127.0.0.1:11434")).rejects.toThrow(/cannot reach ollama/i);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(listModels("http://127.0.0.1:11434")).rejects.toThrow(/503/);
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
      schema: routineCheckJsonSchema(),
    });
    expect(result).toEqual({ routine: true, reason: "deps" });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("prompt 120"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.options).toEqual({ temperature: 0.2 });
    expect(body.options.num_predict).toBeUndefined();
    expect(body.options.num_ctx).toBeUndefined();
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
      schema: routineCheckJsonSchema(),
    });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ routine: true, reason: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
