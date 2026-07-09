// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { loadConfig } from "../config.js";
import { parseAndValidateModelJson } from "../json-response.js";
import { logTokenCall, type TokenUsageTracker } from "../token-usage.js";
import {
  formatFetchError,
  MAX_CHAT_ATTEMPTS,
  normalizeUrl,
  sleep,
  stripTrailingSlashes,
} from "./http.js";
import type { ChatJsonRequest, LlmProvider, LlmProviderKind, LlmUrlOverrides } from "./types.js";

const DEFAULT_TEMPERATURE = 0.2;

/** Default context window when loading models for LM Studio (via `/api/v1/models/load`). */
export const LM_STUDIO_CONTEXT_LENGTH = 32_768;

const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";

const loadedModels = new Set<string>();

function lmStudioRoot(baseUrl: string): string {
  return stripTrailingSlashes(baseUrl).replace(/\/v1$/, "");
}

/** True when the URL points at Ollama's default port (a common LM Studio misconfiguration). */
export function isOllamaDefaultPort(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.includes("://") ? baseUrl : `http://${baseUrl}`);
    if (u.port === "11434") return true;
    return u.port === "" && u.hostname === "127.0.0.1" && baseUrl.includes("11434");
  } catch {
    return baseUrl.includes(":11434");
  }
}

/** True when LM Studio's native REST API responds (`GET /api/v1/models`). */
export async function isLmStudioNativeApi(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${lmStudioRoot(baseUrl)}/api/v1/models`, {
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Finds a reachable LM Studio server via native API probe.
 * @deprecated Prefer {@link LlmProviderRegistry.discover}.
 */
export async function resolveLmStudioDiscoveryUrl(
  flagUrl?: string,
  overrides?: LlmUrlOverrides,
): Promise<string | undefined> {
  const candidates = [
    flagUrl?.trim(),
    overrides?.lmstudio?.trim(),
    resolveLmStudioUrl(overrides),
    DEFAULT_LM_STUDIO_BASE_URL,
  ].filter((u): u is string => Boolean(u));

  const seen = new Set<string>();
  for (const raw of candidates) {
    const baseUrl = lmStudioRoot(raw);
    if (seen.has(baseUrl) || isOllamaDefaultPort(baseUrl)) continue;
    seen.add(baseUrl);
    if (await isLmStudioNativeApi(baseUrl)) return baseUrl;
  }
  return undefined;
}

/** Rewrites mistaken Ollama-port URLs saved for LM Studio slots. */
export function normalizeLmStudioBaseUrl(baseUrl: string): string {
  return isOllamaDefaultPort(baseUrl) ? DEFAULT_LM_STUDIO_BASE_URL : baseUrl;
}

function openAiBase(baseUrl: string): string {
  const root = stripTrailingSlashes(baseUrl);
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

/** Clears the per-process LM Studio load cache (for tests). */
export function resetLmStudioLoadCache(): void {
  loadedModels.clear();
}

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.LM_API_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

interface LmStudioNativeListResponse {
  models?: { loaded_instances?: { id: string }[] }[];
}

/** Unloads every model instance reported by `GET /api/v1/models`. */
export async function unloadAllLmStudioModels(baseUrl: string): Promise<void> {
  const root = lmStudioRoot(baseUrl);
  try {
    const res = await fetch(`${root}/api/v1/models`, { headers: jsonHeaders() });
    if (!res.ok) return;

    const data = (await res.json()) as LmStudioNativeListResponse;
    const instanceIds: string[] = [];
    for (const entry of data.models ?? []) {
      for (const inst of entry.loaded_instances ?? []) {
        if (inst.id) instanceIds.push(inst.id);
      }
    }

    for (const instanceId of instanceIds) {
      try {
        await fetch(`${root}/api/v1/models/unload`, {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ instance_id: instanceId }),
        });
      } catch {
        // Best-effort unload — do not fail the pipeline on cleanup errors.
      }
    }
  } catch {
    // Native list API unreachable (older LM Studio) — nothing to unload via REST.
  }
}

/** Loads the model with {@link LM_STUDIO_CONTEXT_LENGTH}; skips when already cached unless `force`. */
async function loadLmStudioModel(baseUrl: string, model: string, force = false): Promise<void> {
  const key = `${lmStudioRoot(baseUrl)}\0${model}`;
  if (!force && loadedModels.has(key)) return;

  try {
    const res = await fetch(`${lmStudioRoot(baseUrl)}/api/v1/models/load`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        model,
        context_length: LM_STUDIO_CONTEXT_LENGTH,
      }),
    });
    if (res.ok) {
      loadedModels.add(key);
      return;
    }
    if (res.status === 404) return;
    const text = await res.text().catch(() => "");
    process.stderr.write(
      `   note: LM Studio model load returned ${res.status} (${text.slice(0, 120)}); using already-loaded instance\n`,
    );
  } catch {
    // Load endpoint unreachable — chat/completions may still work with a GUI-loaded model.
  }
}

/** Unload all models, then load one for a pipeline step (frees VRAM between steps). */
export async function prepareLmStudioStep(baseUrl: string, model: string): Promise<void> {
  const provider = createLmStudioProvider(baseUrl);
  console.log(`LM Studio: unloading all models at ${provider.getBaseUrl()} ...`);
  await provider.unloadAll();
  console.log(`LM Studio: loading ${model} (${LM_STUDIO_CONTEXT_LENGTH} context) ...`);
  await provider.loadModel(model);
}

/** Unload all models after a pipeline step so LM Studio is free for other use. */
export async function releaseLmStudioStep(baseUrl: string): Promise<void> {
  const provider = createLmStudioProvider(baseUrl);
  console.log(`LM Studio: releasing models at ${provider.getBaseUrl()} ...`);
  await provider.unloadAll();
}

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

type ResponseFormatMode = "json_schema_strict" | "json_schema_relaxed" | "text";

function buildResponseFormat(
  schema: Record<string, unknown>,
  mode: ResponseFormatMode,
): Record<string, unknown> | undefined {
  if (mode === "text") return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: "workgraph_response",
      strict: mode === "json_schema_strict",
      schema,
    },
  };
}

function nextFormatModeOnHttpError(mode: ResponseFormatMode): ResponseFormatMode | undefined {
  if (mode === "json_schema_strict") return "json_schema_relaxed";
  if (mode === "json_schema_relaxed") return "text";
  return undefined;
}

function formatModeNote(mode: ResponseFormatMode): string {
  if (mode === "json_schema_relaxed") {
    return "   note: retrying LM Studio with relaxed json_schema response_format\n";
  }
  return "   note: retrying LM Studio without response_format (plain text JSON)\n";
}

async function chatJsonOnce(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  formatMode: ResponseFormatMode;
}): Promise<{ data: unknown; promptTokens: number; completionTokens: number }> {
  const responseFormat = buildResponseFormat(opts.schema, opts.formatMode);
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    temperature: DEFAULT_TEMPERATURE,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(`${openAiBase(opts.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `LM Studio /v1/chat/completions returned ${res.status}: ${text.slice(0, 200)}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(
      `LM Studio returned empty content (finish_reason=${choice?.finish_reason ?? "unknown"})`,
    );
  }
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const parsed = parseAndValidateModelJson(content, opts.schema);
  if (choice?.finish_reason === "length") {
    process.stderr.write("   warning: LM Studio finish_reason=length but response validated OK\n");
  }
  return { data: parsed, promptTokens, completionTokens };
}

async function chatJsonWithRetry(baseUrl: string, opts: ChatJsonRequest): Promise<unknown> {
  await loadLmStudioModel(baseUrl, opts.model, false);

  const maxAttempts = opts.maxAttempts ?? MAX_CHAT_ATTEMPTS;
  let lastError: Error | undefined;
  let formatMode: ResponseFormatMode = "json_schema_strict";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, promptTokens, completionTokens } = await chatJsonOnce({
        baseUrl,
        model: opts.model,
        system: opts.system,
        user: opts.user,
        schema: opts.schema,
        formatMode,
      });
      recordAndLogUsage(opts.tracker, opts.model, promptTokens, completionTokens);
      return data;
    } catch (err) {
      const error = err as Error & { status?: number };
      const nextMode = nextFormatModeOnHttpError(formatMode);
      if ((error.status === 400 || error.status === 422) && nextMode) {
        formatMode = nextMode;
        process.stderr.write(formatModeNote(formatMode));
        continue;
      }
      lastError = error;
      if (attempt < maxAttempts) {
        process.stderr.write(
          `\n   retry ${attempt}/${maxAttempts - 1} (${lastError.message.slice(0, 80)}) `,
        );
        await sleep(750 * attempt);
      }
    }
  }
  throw new Error(
    `LM Studio chat failed after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

async function fetchLmStudioModels(baseUrl: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${openAiBase(baseUrl)}/models`);
  } catch (err) {
    throw new Error(`Cannot reach LM Studio at ${baseUrl} (${formatFetchError(err)})`);
  }
  if (!res.ok) throw new Error(`LM Studio /v1/models returned ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

/** Creates an LM Studio provider bound to a specific server URL. */
export function createLmStudioProvider(baseUrl: string): LlmProvider {
  const normalized = normalizeLmStudioBaseUrl(baseUrl);

  return {
    id: "lmstudio",

    getName(): string {
      return "LM Studio";
    },

    getBaseUrl(): string {
      return lmStudioRoot(normalized);
    },

    async isReachable(): Promise<boolean> {
      if (!(await isLmStudioNativeApi(normalized))) return false;
      try {
        return (await this.getModels()).length > 0;
      } catch {
        return false;
      }
    },

    async getModels(): Promise<string[]> {
      return fetchLmStudioModels(normalized);
    },

    async loadModel(model: string): Promise<void> {
      await loadLmStudioModel(normalized, model, true);
    },

    async unloadAll(): Promise<void> {
      await unloadAllLmStudioModels(normalized);
      loadedModels.clear();
    },

    chatJson(opts: ChatJsonRequest): Promise<unknown> {
      return chatJsonWithRetry(normalized, opts);
    },
  };
}

function legacyLmStudioConfigUrl(): string | undefined {
  const saved = loadConfig().llm;
  if (!saved?.baseUrl || saved.provider !== "lmstudio") return undefined;
  if (isOllamaDefaultPort(saved.baseUrl)) return undefined;
  return saved.baseUrl.trim();
}

function resolveLmStudioUrl(overrides?: LlmUrlOverrides): string {
  const saved = loadConfig().llm;
  const flag = normalizeUrl(overrides?.lmstudio);
  const fromConfig = legacyLmStudioConfigUrl();
  return (
    (flag && !isOllamaDefaultPort(flag) ? flag : undefined) ??
    normalizeUrl(saved?.servers?.lmstudio) ??
    normalizeUrl(process.env.LM_STUDIO_BASE_URL) ??
    (fromConfig && !isOllamaDefaultPort(fromConfig) ? fromConfig : undefined) ??
    DEFAULT_LM_STUDIO_BASE_URL
  );
}

function printLmStudioInstallHelp(): void {
  console.log("\nHow to use LM Studio:");
  console.log("  Download: https://lmstudio.ai");
  console.log("  Load a model in the app, then start the local server (default port 1234).");
  console.log("  Models appear in dev-workgraph alongside Ollama when the server is running.");
}

function printLmStudioNoModelsHelp(): void {
  console.log("\nLoad a model in LM Studio and ensure the local server is running.");
}

/** LM Studio provider plugin (CLI, URL resolution, session lifecycle, factory). */
export const lmstudioKind: LlmProviderKind = {
  id: "lmstudio",
  displayName: "LM Studio",
  defaultBaseUrl: DEFAULT_LM_STUDIO_BASE_URL,
  cliUrlOption: "--lmstudio-url <url>",
  cliUrlDescription: `LM Studio server URL (default ${DEFAULT_LM_STUDIO_BASE_URL})`,
  needsStepLifecycle: true,
  aliases: ["lm-studio", "lm_studio"],
  create: createLmStudioProvider,
  resolveUrl: resolveLmStudioUrl,
  acceptForDiscovery: isLmStudioNativeApi,
  prepareStep: prepareLmStudioStep,
  releaseStep: releaseLmStudioStep,
  printInstallHelp: printLmStudioInstallHelp,
  printNoModelsHelp: printLmStudioNoModelsHelp,
};
