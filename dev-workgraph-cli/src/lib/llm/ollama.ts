// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { parseAndValidateModelJson } from "../json-response.js";
import { logTokenCall, type TokenUsageTracker } from "../token-usage.js";
import { formatFetchError, MAX_CHAT_ATTEMPTS, normalizeUrl, sleep } from "./http.js";
import type { ChatJsonRequest, LlmProvider, LlmProviderKind, LlmUrlOverrides } from "./types.js";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/** Suggested models to pull when none are installed. */
const SUGGESTED_OLLAMA_MODELS = ["qwen2.5-coder:14b", "gpt-oss:latest"];

/** True when the `ollama` binary is on PATH. */
function ollamaInstalled(): boolean {
  try {
    execFileSync("ollama", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function printOllamaInstallHelp(): void {
  console.log("\nHow to install Ollama:");
  if (process.platform === "darwin") {
    console.log("  macOS:  brew install ollama");
    console.log("          (or download the app: https://ollama.com/download)");
    console.log("  Start:  ollama serve     (or open the Ollama app)");
  } else if (process.platform === "linux") {
    console.log("  Linux:  curl -fsSL https://ollama.com/install.sh | sh");
    console.log("  Start:  ollama serve");
  } else {
    console.log("  Download: https://ollama.com/download");
    console.log("  Start:    ollama serve");
  }
  console.log("\nThen pull a model, e.g.:");
  for (const m of SUGGESTED_OLLAMA_MODELS) console.log(`  ollama pull ${m}`);
}

function printOllamaNoModelsHelp(): void {
  console.log("\nPull a model, e.g.:");
  for (const m of SUGGESTED_OLLAMA_MODELS) console.log(`  ollama pull ${m}`);
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

async function chatJsonOnce(opts: {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
  think?: boolean;
}): Promise<{ data: unknown; promptTokens: number; completionTokens: number }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    format: opts.schema,
    options: { ...DEFAULT_CHAT_OPTIONS, ...opts.ollamaOptions },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.think !== undefined) {
    body.think = opts.think;
  }
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama /api/chat returned ${res.status}: ${text.slice(0, 200)}`);
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

async function chatJsonWithRetry(baseUrl: string, opts: ChatJsonRequest): Promise<unknown> {
  const maxAttempts = opts.maxAttempts ?? MAX_CHAT_ATTEMPTS;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { data, promptTokens, completionTokens } = await chatJsonOnce({
        baseUrl,
        model: opts.model,
        system: opts.system,
        user: opts.user,
        schema: opts.schema,
        ollamaOptions: opts.ollamaOptions,
        think: opts.think,
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

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
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

/** Creates an Ollama provider bound to a specific server URL. */
function createOllamaProvider(baseUrl: string): LlmProvider {
  return {
    id: "ollama",

    getName(): string {
      return "Ollama";
    },

    getBaseUrl(): string {
      return baseUrl;
    },

    async isReachable(): Promise<boolean> {
      try {
        return (await this.getModels()).length > 0;
      } catch {
        return false;
      }
    },

    async getModels(): Promise<string[]> {
      return fetchOllamaModels(baseUrl);
    },

    async loadModel(_model: string): Promise<void> {
      // Ollama keeps models on disk; no explicit load step.
    },

    async unloadAll(): Promise<void> {
      // No-op for Ollama.
    },

    chatJson(opts: ChatJsonRequest): Promise<unknown> {
      return chatJsonWithRetry(baseUrl, opts);
    },
  };
}

function legacyConfigUrl(providerId: "ollama" | "lmstudio"): string | undefined {
  const saved = loadConfig().llm;
  if (!saved?.baseUrl || saved.provider !== providerId) return undefined;
  return saved.baseUrl.trim();
}

function resolveOllamaUrl(overrides?: LlmUrlOverrides): string {
  const saved = loadConfig().llm;
  return (
    normalizeUrl(overrides?.ollama) ??
    normalizeUrl(saved?.servers?.ollama) ??
    normalizeUrl(process.env.WORKGRAPH_OLLAMA_URL) ??
    normalizeUrl(process.env.WORKGRAPH_LLM_URL) ??
    normalizeUrl(process.env.OLLAMA_HOST) ??
    legacyConfigUrl("ollama") ??
    DEFAULT_OLLAMA_URL
  );
}

/** Ollama provider plugin (CLI, URL resolution, factory). */
export const ollamaKind: LlmProviderKind = {
  id: "ollama",
  displayName: "Ollama",
  defaultBaseUrl: DEFAULT_OLLAMA_URL,
  cliUrlOption: "--ollama-url <url>",
  cliUrlDescription: `Ollama server URL (default ${DEFAULT_OLLAMA_URL})`,
  needsStepLifecycle: false,
  create: createOllamaProvider,
  resolveUrl: resolveOllamaUrl,
  async acceptForDiscovery() {
    return true;
  },
  printInstallHelp: printOllamaInstallHelp,
  printNoModelsHelp: printOllamaNoModelsHelp,
  isBinaryInstalled: ollamaInstalled,
};
