// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { lmstudioKind } from "./lmstudio.js";
import { ollamaKind } from "./ollama.js";
import type { LlmProvider, LlmProviderId, LlmProviderKind, LlmUrlOverrides } from "./types.js";

/** Registered LLM backends — add a new {@link LlmProviderKind} here to extend the CLI. */
export const LLM_PROVIDER_KINDS: readonly LlmProviderKind[] = [ollamaKind, lmstudioKind];

export function defaultProviderId(): LlmProviderId {
  const kind = LLM_PROVIDER_KINDS[0];
  if (!kind) throw new Error("No LLM providers registered");
  return kind.id;
}

const KIND_BY_ID = new Map<LlmProviderId, LlmProviderKind>(
  LLM_PROVIDER_KINDS.map((kind) => [kind.id, kind]),
);

export function getProviderKind(id: LlmProviderId): LlmProviderKind {
  const kind = KIND_BY_ID.get(id);
  if (!kind) throw new Error(`Unknown LLM provider "${id}"`);
  return kind;
}

/** Commander-parsed field for a provider URL flag (`--ollama-url` → `ollamaUrl`). */
function cliUrlFieldName(id: LlmProviderId): string {
  return `${id}Url`;
}

export function normalizeProviderId(value?: string): LlmProviderId | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  for (const kind of LLM_PROVIDER_KINDS) {
    if (kind.id === raw) return kind.id;
    if (kind.aliases?.includes(raw)) return kind.id;
  }
  throw new Error(
    `Unknown LLM provider "${value}". Use ${LLM_PROVIDER_KINDS.map((k) => k.id).join(" or ")}.`,
  );
}

export function providerDisplayName(id: LlmProviderId): string {
  return getProviderKind(id).displayName;
}

export function resolveServerUrl(id: LlmProviderId, overrides?: LlmUrlOverrides): string {
  return getProviderKind(id).resolveUrl(overrides);
}

export function createLlmProvider(id: LlmProviderId, baseUrl: string): LlmProvider {
  return getProviderKind(id).create(baseUrl);
}

/** Reads per-provider URL overrides from Commander-parsed options. */
export function pickLlmUrlOverrides(opts: Record<string, unknown>): LlmUrlOverrides {
  const urls: LlmUrlOverrides = {};
  for (const kind of LLM_PROVIDER_KINDS) {
    const value = opts[cliUrlFieldName(kind.id)];
    if (typeof value === "string" && value.trim()) urls[kind.id] = value.trim();
  }
  return urls;
}
