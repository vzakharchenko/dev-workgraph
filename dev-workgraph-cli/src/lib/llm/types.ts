// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { TokenUsageTracker } from "../token-usage.js";

/** Supported local LLM backends (extend {@link LLM_PROVIDER_KINDS} to add more). */
export type LlmProviderId = "ollama" | "lmstudio";

/** Per-provider server URL overrides (`ollama`, `lmstudio`, …). */
export type LlmUrlOverrides = Partial<Record<LlmProviderId, string>>;

export interface LlmResolveOptions extends LlmUrlOverrides {
  model?: string;
}

/** A reachable LLM backend with at least one loaded model. */
export interface LlmBackend {
  providerId: LlmProviderId;
  baseUrl: string;
  models: string[];
}

/** Model choice bound to a specific backend. */
export interface LlmModelChoice {
  providerId: LlmProviderId;
  baseUrl: string;
  model: string;
}

/** Chat request without routing fields (provider holds base URL). */
export interface ChatJsonRequest {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
  think?: boolean;
  maxAttempts?: number;
  tracker?: TokenUsageTracker;
}

/** Chat options used by actions that pass explicit baseUrl + provider. */
export interface ChatJsonOptions extends ChatJsonRequest {
  provider?: LlmProviderId;
  baseUrl: string;
}

/**
 * Runtime LLM backend at a specific server URL (chat, models, load/unload).
 * Created by {@link LlmProviderKind.create}.
 */
export interface LlmProvider {
  readonly id: LlmProviderId;
  getName(): string;
  getBaseUrl(): string;
  isReachable(): Promise<boolean>;
  getModels(): Promise<string[]>;
  loadModel(model: string): Promise<void>;
  unloadAll(): Promise<void>;
  chatJson(opts: ChatJsonRequest): Promise<unknown>;
}

/**
 * Static provider plugin: CLI flags, URL resolution, discovery, optional step lifecycle.
 * Register new backends in {@link LLM_PROVIDER_KINDS}.
 */
export interface LlmProviderKind {
  readonly id: LlmProviderId;
  readonly displayName: string;
  readonly defaultBaseUrl: string;
  /** Commander option, e.g. `--ollama-url <url>`. */
  readonly cliUrlOption: string;
  readonly cliUrlDescription: string;
  /** When true, pipeline steps call {@link prepareStep} / {@link releaseStep}. */
  readonly needsStepLifecycle: boolean;
  /** CLI aliases accepted by {@link normalizeProviderId}. */
  readonly aliases?: readonly string[];
  create(baseUrl: string): LlmProvider;
  resolveUrl(overrides?: LlmUrlOverrides): string;
  /** Gate before discovery (e.g. LM Studio native API). Default: always true. */
  acceptForDiscovery(baseUrl: string): Promise<boolean>;
  prepareStep?(baseUrl: string, model: string): Promise<void>;
  releaseStep?(baseUrl: string): Promise<void>;
  /** Console instructions when the backend is missing or unreachable. */
  printInstallHelp(): void;
  /** Console hints when the server responds but has no models loaded. */
  printNoModelsHelp(): void;
  /** True when the provider CLI is on PATH but the server may be down (e.g. Ollama). */
  isBinaryInstalled?(): boolean;
}
