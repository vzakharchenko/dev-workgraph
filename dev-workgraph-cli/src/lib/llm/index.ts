// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { loadConfig } from "../config.js";
import {
  createLlmProvider,
  defaultProviderId,
  normalizeProviderId,
  providerDisplayName,
  resolveServerUrl,
} from "./providers.js";
import { createLlmRegistry, type LlmProviderRegistry } from "./registry.js";
import type {
  ChatJsonOptions,
  LlmBackend,
  LlmProviderId,
  LlmResolveOptions,
  LlmUrlOverrides,
} from "./types.js";

/** Resolved provider from explicit id or saved config (defaults to first registered kind). */
export function resolveProviderId(providerId?: string): LlmProviderId {
  return (
    normalizeProviderId(providerId) ??
    normalizeProviderId(loadConfig().llm?.provider) ??
    defaultProviderId()
  );
}

function registryFromOpts(opts?: LlmResolveOptions): LlmProviderRegistry {
  return createLlmRegistry(opts);
}

export function providerLabel(id?: string): string {
  return providerDisplayName(resolveProviderId(id));
}

export function resolveBaseUrl(providerId: LlmProviderId, overrides?: LlmUrlOverrides): string {
  return resolveServerUrl(providerId, overrides);
}

export async function listModels(baseUrl: string, providerId?: string): Promise<string[]> {
  const id = resolveProviderId(providerId);
  return createLlmProvider(id, baseUrl).getModels();
}

export async function discoverLlmBackends(opts?: LlmResolveOptions): Promise<LlmBackend[]> {
  const registry = registryFromOpts(opts);
  const providers = await registry.discover();
  const backends: LlmBackend[] = [];
  for (const provider of providers) {
    backends.push({
      providerId: provider.id,
      baseUrl: provider.getBaseUrl(),
      models: await provider.getModels(),
    });
  }
  return backends;
}

export { noLlmBackendsError } from "./install-help.js";
export { createLlmRegistry } from "./registry.js";

export async function chatJson(opts: ChatJsonOptions): Promise<unknown> {
  const providerId = resolveProviderId(opts.provider);
  const provider = createLlmProvider(providerId, opts.baseUrl);
  return provider.chatJson(opts);
}
