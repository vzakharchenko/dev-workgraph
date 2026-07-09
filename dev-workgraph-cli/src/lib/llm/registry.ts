// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { getProviderKind, LLM_PROVIDER_KINDS } from "./providers.js";
import type { LlmModelChoice, LlmProvider, LlmUrlOverrides } from "./types.js";

/**
 * Registry of LLM backends with per-provider URLs.
 * Provider list and CLI flags come from {@link LLM_PROVIDER_KINDS}.
 */
export class LlmProviderRegistry {
  constructor(private readonly overrides?: LlmUrlOverrides) {}

  get(id: LlmProvider["id"]): LlmProvider {
    const kind = getProviderKind(id);
    return kind.create(kind.resolveUrl(this.overrides));
  }

  async discover(): Promise<LlmProvider[]> {
    const found: LlmProvider[] = [];
    for (const kind of LLM_PROVIDER_KINDS) {
      const provider = this.get(kind.id);
      if (!(await kind.acceptForDiscovery(provider.getBaseUrl()))) continue;
      try {
        const models = await provider.getModels();
        if (models.length > 0) found.push(provider);
      } catch {
        // Unreachable — try the next backend.
      }
    }
    return found;
  }

  async listModelChoices(): Promise<LlmModelChoice[]> {
    const choices: LlmModelChoice[] = [];
    for (const provider of await this.discover()) {
      const baseUrl = provider.getBaseUrl();
      for (const model of await provider.getModels()) {
        choices.push({ providerId: provider.id, baseUrl, model });
      }
    }
    return choices.sort((a, b) => {
      const byProvider = a.providerId.localeCompare(b.providerId);
      return byProvider === 0 ? a.model.localeCompare(b.model) : byProvider;
    });
  }
}

export function createLlmRegistry(overrides?: LlmUrlOverrides): LlmProviderRegistry {
  return new LlmProviderRegistry(overrides);
}
