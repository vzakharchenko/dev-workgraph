// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { Agent, setGlobalDispatcher } from "undici";
import { parseAndValidateModelJson } from "./json-response.js";
import { logTokenCall, type TokenUsageTracker } from "./token-usage.js";

/** Default Ollama endpoint. */
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Node's fetch defaults to ~1 hour headers timeout; large local models can exceed that. */
const OLLAMA_HEADERS_TIMEOUT_MS = 60 * 60 * 1000;
const OLLAMA_BODY_TIMEOUT_MS = 60 * 60 * 1000;

setGlobalDispatcher(
  new Agent({
    headersTimeout: OLLAMA_HEADERS_TIMEOUT_MS,
    bodyTimeout: OLLAMA_BODY_TIMEOUT_MS,
  }),
);

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return end === url.length ? url : url.slice(0, end);
}

/**
 * Normalizes a user-supplied endpoint into a scheme-qualified base URL with no
 * trailing slash. Accepts `host:port`, `http://host:port`, or undefined.
 * @param value - Raw endpoint string.
 */
function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  let url = value.trim();
  if (!url) return undefined;
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  return stripTrailingSlashes(url);
}

/**
 * Resolves the Ollama base URL from a flag, then `OLLAMA_HOST`, then the
 * default localhost endpoint.
 * @param flag - Value of the `--url` flag, if any.
 */
export function resolveBaseUrl(flag?: string): string {
  return normalizeUrl(flag) ?? normalizeUrl(process.env.OLLAMA_HOST) ?? DEFAULT_BASE_URL;
}

/**
 * Lists the model names available on the Ollama server.
 * @param baseUrl - Resolved Ollama base URL.
 * @throws When the server is unreachable or returns an error.
 */
export async function listModels(baseUrl: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`);
  } catch (err) {
    throw new Error(`Cannot reach Ollama at ${baseUrl} (${formatFetchError(err)})`);
  }
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name);
}

/**
 * Sends a chat completion to Ollama and parses the response as JSON, using the
 * `format` schema to force schema-valid output.
 * @param opts.baseUrl - Resolved Ollama base URL.
 * @param opts.model - Model name to use.
 * @param opts.system - System prompt.
 * @param opts.user - User prompt.
 * @param opts.schema - JSON Schema for the `format` parameter.
 */
/** Total attempts for a chat call before giving up (HTTP/parse failures are retried). */
const MAX_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function formatFetchError(err: unknown): string {
  const error = err as Error & { cause?: { code?: string; message?: string } };
  const cause = error.cause;
  if (cause?.code) return `${error.message} [${cause.code}]`;
  return error.message;
}

/** Default Ollama generation options; num_ctx / num_predict come from the model Modelfile. */
const DEFAULT_CHAT_OPTIONS = {
  temperature: 0.2,
} as const;

function recordAndLogUsage(
  tracker: TokenUsageTracker | undefined,
  model: string,
  promptTokens: number,
  completionTokens: number,
): void {
  tracker?.recordCall({ model, promptTokens, completionTokens });
  logTokenCall({
    step: tracker?.step ?? null,
    model,
    promptTokens,
    completionTokens,
  });
}

/** One chat attempt: POST, check status, parse the JSON content. */
async function chatJsonOnce(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
}): Promise<{ data: unknown; promptTokens: number; completionTokens: number }> {
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      format: opts.schema,
      think: false,
      options: { ...DEFAULT_CHAT_OPTIONS, ...opts.ollamaOptions },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama /api/chat returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    done_reason?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const content = data.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(`Ollama returned empty content (done_reason=${data.done_reason ?? "unknown"})`);
  }
  const promptTokens = data.prompt_eval_count ?? 0;
  const completionTokens = data.eval_count ?? 0;
  const parsed = parseAndValidateModelJson(content, opts.schema);
  if (data.done_reason === "length") {
    process.stderr.write("   warning: Ollama done_reason=length but response validated OK\n");
  }
  return { data: parsed, promptTokens, completionTokens };
}

export async function chatJson(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
  maxAttempts?: number;
  tracker?: TokenUsageTracker;
}): Promise<unknown> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, promptTokens, completionTokens } = await chatJsonOnce({
        ...opts,
        ollamaOptions: { ...opts.ollamaOptions },
      });
      recordAndLogUsage(opts.tracker, opts.model, promptTokens, completionTokens);
      return data;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts) {
        process.stderr.write(
          `\n   retry ${attempt}/${maxAttempts - 1} (${lastError.message.slice(0, 80)}) `,
        );
        await sleep(750 * attempt);
      }
    }
  }
  throw new Error(
    `Ollama chat failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}
