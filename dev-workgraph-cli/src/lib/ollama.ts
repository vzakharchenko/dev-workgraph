// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { parseAndValidateModelJson } from "./json-response.js";

/** Default Ollama endpoint. */
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

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
  return url.replace(/\/+$/, "");
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
    throw new Error(`Cannot reach Ollama at ${baseUrl} (${(err as Error).message})`);
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

/** num_predict escalates on each retry; last attempt uses -1 (Ollama: no output cap). */
const NUM_PREDICT_BY_ATTEMPT = [8192, 16384, -1] as const;

/** num_ctx escalates on each retry; last attempt uses the largest supported window. */
const NUM_CTX_BY_ATTEMPT = [16384, 32768, 65536] as const;

function numPredictForAttempt(attempt: number): number {
  const idx = attempt - 1;
  return NUM_PREDICT_BY_ATTEMPT[idx] ?? -1;
}

function numCtxForAttempt(attempt: number): number {
  const idx = attempt - 1;
  const last = NUM_CTX_BY_ATTEMPT[NUM_CTX_BY_ATTEMPT.length - 1] ?? 65536;
  return NUM_CTX_BY_ATTEMPT[idx] ?? last;
}

/** Default Ollama generation options (num_ctx / num_predict set per attempt in chatJson). */
const DEFAULT_CHAT_OPTIONS = {
  temperature: 0.2,
} as const;

/** One chat attempt: POST, check status, parse the JSON content. */
async function chatJsonOnce(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
}): Promise<unknown> {
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
  };
  const content = data.message?.content ?? "";
  if (data.done_reason === "length") {
    throw new Error(
      `model output truncated (token limit); content starts: ${content.slice(0, 120)}`,
    );
  }
  return parseAndValidateModelJson(content, opts.schema);
}

export async function chatJson(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<unknown> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const num_predict = numPredictForAttempt(attempt);
    const num_ctx = numCtxForAttempt(attempt);
    try {
      return await chatJsonOnce({
        ...opts,
        ollamaOptions: { ...opts.ollamaOptions, num_predict, num_ctx },
      });
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts) {
        const nextPredict = numPredictForAttempt(attempt + 1);
        const nextCtx = numCtxForAttempt(attempt + 1);
        process.stderr.write(
          `\n   retry ${attempt}/${maxAttempts - 1} (${lastError.message.slice(0, 80)}) num_ctx→${nextCtx} num_predict→${nextPredict} `,
        );
        await sleep(750 * attempt);
      }
    }
  }
  throw new Error(
    `Ollama chat failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}
