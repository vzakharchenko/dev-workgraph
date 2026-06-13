// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

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
export async function chatJson(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
}): Promise<unknown> {
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      format: opts.schema,
      options: { temperature: 0.2 },
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

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Model returned non-JSON content: ${content.slice(0, 200)}`);
  }
}