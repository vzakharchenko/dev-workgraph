// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { type LlmConfig, loadConfig, setLlmConfig } from "./config.js";
import type { LlmModelChoice, LlmProviderId } from "./llm/types.js";
import { resolveBaseUrl } from "./ollama.js";

/** LLM preference slot: commit work, report fold, or narrative stages. */
export type LlmSlotId = "commit" | "report" | "narrative";

/** Saved provider, base URL, and model for one pipeline stage. */
export interface LlmSlotConfig {
  provider: LlmProviderId;
  baseUrl: string;
  model: string;
}

const SLOT_MESSAGES: Record<LlmSlotId, string> = {
  commit: "Which model for commit summaries & commit-group?",
  report: "Which model for report?",
  narrative: "Which model for project context, prepare & final?",
};

function legacySlotModel(cfg: LlmConfig | undefined, slot: LlmSlotId): string | undefined {
  if (!cfg) return undefined;
  if (slot === "commit") return cfg.commitModel ?? cfg.model;
  if (slot === "report") return cfg.reportModel ?? cfg.model;
  return cfg.narrativeModel ?? cfg.reportModel ?? cfg.model;
}

/** Reads a saved slot, falling back to legacy flat model + global provider fields. */
export function getLlmSlot(cfg: LlmConfig | undefined, slot: LlmSlotId): LlmSlotConfig | undefined {
  const nested = cfg?.[slot];
  const model = nested?.model ?? legacySlotModel(cfg, slot);
  if (!model) return undefined;
  const provider = nested?.provider ?? cfg?.provider ?? "ollama";
  const nestedUrl = nested?.baseUrl?.trim() || undefined;
  const globalBaseUrl =
    cfg?.baseUrl?.trim() && cfg.provider === provider ? cfg.baseUrl.trim() : undefined;
  const baseUrl = nestedUrl ?? globalBaseUrl ?? resolveBaseUrl(provider);
  return { provider, baseUrl, model };
}

/** Default picker seed for a slot (includes cross-slot fallbacks for narrative). */
export function savedSeedForSlot(
  slot: LlmSlotId,
  cfg?: LlmConfig,
): { saved?: string; savedProvider?: string } {
  const c = cfg ?? loadConfig().llm;
  const primary = getLlmSlot(c, slot);
  if (primary) return { saved: primary.model, savedProvider: primary.provider };
  if (slot === "narrative") {
    const report = getLlmSlot(c, "report");
    if (report) return { saved: report.model, savedProvider: report.provider };
  }
  const legacy = c?.model;
  if (legacy) return { saved: legacy, savedProvider: c?.provider };
  return {};
}

/** Persists a slot choice (nested slot + legacy model name for compatibility). */
export function saveLlmSlot(slot: LlmSlotId, choice: LlmModelChoice): void {
  const slotConfig: LlmSlotConfig = {
    provider: choice.providerId,
    baseUrl: choice.baseUrl,
    model: choice.model,
  };
  const patch: LlmConfig = { [slot]: slotConfig };
  if (slot === "commit") patch.commitModel = choice.model;
  else if (slot === "report") patch.reportModel = choice.model;
  else patch.narrativeModel = choice.model;
  setLlmConfig(patch);
}

export function slotMessage(slot: LlmSlotId, override?: string): string {
  return override ?? SLOT_MESSAGES[slot];
}
