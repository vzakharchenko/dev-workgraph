// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { loadConfig } from "../lib/config.js";
import type { LlmCommandOptions } from "../lib/llm/cli-options.js";
import { printNoLlmBackendsHelp } from "../lib/llm/install-help.js";
import { getProviderKind } from "../lib/llm/providers.js";
import type { LlmProviderId } from "../lib/llm/types.js";
import { getLlmSlot, type LlmSlotId } from "../lib/llm-slots.js";
import {
  discoverLlmBackends,
  listModels,
  providerLabel,
  resolveProviderId,
} from "../lib/ollama.js";

/**
 * Options for the `check` command.
 */
export interface CheckOptions extends LlmCommandOptions {}

function emptyModelsHelp(providerId: LlmProviderId, baseUrl: string): void {
  const label = providerLabel(providerId);
  console.log(`⚠️  ${label} is running at ${baseUrl}, but no models are available.`);
  getProviderKind(providerId).printNoModelsHelp();
}

/**
 * Verifies the LLM backend is reachable and has at least one model.
 * Returns true when ready. Reused as a `run` preflight.
 */
export async function llmReady(baseUrl: string, provider?: string): Promise<boolean> {
  const providerId = resolveProviderId(provider);
  const kind = getProviderKind(providerId);
  const label = providerLabel(providerId);
  let models: string[];
  try {
    models = await listModels(baseUrl, providerId);
  } catch (err) {
    console.log(`✖ Cannot reach ${label} at ${baseUrl} (${(err as Error).message}).`);
    if (kind.isBinaryInstalled?.()) {
      console.log("Ollama is installed but not responding — start the server: `ollama serve`");
    } else {
      kind.printInstallHelp();
    }
    return false;
  }

  if (models.length === 0) {
    emptyModelsHelp(providerId, baseUrl);
    return false;
  }

  console.log(`✅ ${label} is running with ${models.length} model(s):`);
  for (const m of models) console.log(`   • ${m}`);
  return true;
}

/**
 * Checks that the LLM backend is reachable and has models, then reports saved
 * model preferences and flags any that are missing.
 */
export async function check(options: CheckOptions): Promise<void> {
  const backends = await discoverLlmBackends(options);
  if (backends.length === 0) {
    printNoLlmBackendsHelp();
    process.exitCode = 1;
    return;
  }

  let allReady = true;
  for (const backend of backends) {
    console.log(`Checking ${providerLabel(backend.providerId)} at ${backend.baseUrl} ...`);
    if (!(await llmReady(backend.baseUrl, backend.providerId))) allReady = false;
  }
  if (!allReady) {
    process.exitCode = 1;
    return;
  }

  const cfg = loadConfig().llm;
  const slotIds: LlmSlotId[] = ["commit", "report", "narrative"];
  let anyMissing = false;
  for (const slotId of slotIds) {
    const slot = getLlmSlot(cfg, slotId);
    if (!slot) continue;
    const models = await listModels(slot.baseUrl, slot.provider);
    const missing = !models.includes(slot.model);
    if (missing) anyMissing = true;
    console.log(
      `   ${slotId}: ${slot.model} (${providerLabel(slot.provider)} @ ${slot.baseUrl})${missing ? "  (NOT available)" : ""}`,
    );
  }
  if (anyMissing) {
    console.log("\n⚠️  Saved model(s) not available — load/pull them or re-pick on the next run.");
    process.exitCode = 1;
  }
}
