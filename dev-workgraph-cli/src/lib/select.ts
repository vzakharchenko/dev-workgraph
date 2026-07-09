// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import inquirer from "inquirer";
import { noLlmBackendsError } from "./llm/index.js";
import type { LlmModelChoice, LlmUrlOverrides } from "./llm/types.js";
import { type LlmSlotId, savedSeedForSlot, saveLlmSlot, slotMessage } from "./llm-slots.js";
import {
  createLlmRegistry,
  discoverLlmBackends,
  listModels,
  providerLabel,
  resolveProviderId,
} from "./ollama.js";

export type LlmResolveOpts = LlmUrlOverrides & {
  model?: string;
  message?: string;
  saved?: string;
  savedProvider?: string;
};

/**
 * Resolves an LLM model on a fixed backend: the flag if given, else an interactive picker
 * seeded from `opts.saved`. Does not persist — the caller stores it in the
 * appropriate config slot.
 */
export async function resolveModel(
  baseUrl: string,
  flagModel?: string,
  opts?: { message?: string; saved?: string; providerId?: string },
): Promise<string> {
  const providerId = resolveProviderId(opts?.providerId);
  const label = providerLabel(providerId);
  const available = await listModels(baseUrl, providerId);
  if (available.length === 0) {
    const hint =
      providerId === "lmstudio"
        ? `No models available on LM Studio at ${baseUrl}. Load a model and start the server.`
        : `No models installed on Ollama at ${baseUrl}. Run \`ollama pull <model>\`.`;
    throw new Error(hint);
  }
  if (flagModel) {
    if (!available.includes(flagModel)) {
      throw new Error(`Model "${flagModel}" not found. Available: ${available.join(", ")}`);
    }
    return flagModel;
  }
  const saved = opts?.saved;
  const { model } = await inquirer.prompt<{ model: string }>([
    {
      type: "select",
      name: "model",
      message: opts?.message ?? `Which ${label} model? (${baseUrl})`,
      choices: available,
      default: saved && available.includes(saved) ? saved : available[0],
    },
  ]);
  return model;
}

function pickDefaultChoice(
  choices: LlmModelChoice[],
  saved?: string,
  savedProvider?: string,
): LlmModelChoice | undefined {
  if (saved) {
    if (savedProvider) {
      const exact = choices.find((c) => c.model === saved && c.providerId === savedProvider);
      if (exact) return exact;
    }
    return choices.find((c) => c.model === saved);
  }
  return choices[0];
}

function formatModelChoice(choice: LlmModelChoice): string {
  return `${choice.model}  (${providerLabel(choice.providerId)})`;
}

function logDiscoveredBackends(backends: Awaited<ReturnType<typeof discoverLlmBackends>>): void {
  for (const backend of backends) {
    console.log(
      `  ${providerLabel(backend.providerId)} @ ${backend.baseUrl}: ${backend.models.length} model(s)`,
    );
  }
}

async function promptModelChoice(
  choices: LlmModelChoice[],
  opts?: { message?: string; saved?: string; savedProvider?: string },
): Promise<LlmModelChoice> {
  const defaultChoice = pickDefaultChoice(choices, opts?.saved, opts?.savedProvider);
  const { pick } = await inquirer.prompt<{ pick: LlmModelChoice }>([
    {
      type: "select",
      name: "pick",
      message: opts?.message ?? "Which model?",
      choices: choices.map((c) => ({
        name: formatModelChoice(c),
        value: c,
      })),
      default: defaultChoice,
    },
  ]);
  return pick;
}

/**
 * Probes available backends, then resolves model + provider together.
 * Ollama and LM Studio are both probed; models from all reachable backends
 * appear in one list.
 */
export async function resolveLlmWithModel(opts?: LlmResolveOpts): Promise<LlmModelChoice> {
  const registry = createLlmRegistry(opts);

  const backends = await discoverLlmBackends(opts);
  if (backends.length === 0) {
    throw noLlmBackendsError();
  }

  logDiscoveredBackends(backends);

  const choices = await registry.listModelChoices();
  if (opts?.model) {
    const matches = choices.filter((c) => c.model === opts.model);
    if (matches.length === 0) {
      const available = choices.map(formatModelChoice).join(", ");
      throw new Error(`Model "${opts.model}" not found. Available: ${available}`);
    }
    if (matches.length === 1) {
      const match = matches[0];
      if (match) return match;
    }
    return promptModelChoice(matches, opts);
  }

  if (choices.length === 1) {
    const only = choices[0];
    if (only) return only;
  }
  return promptModelChoice(choices, opts);
}

/**
 * Resolves model + provider for a pipeline slot, probing all reachable backends.
 * Persists the choice under `commit`, `report`, or `narrative` in config.
 */
export async function resolveLlmSlot(
  slot: LlmSlotId,
  opts?: LlmResolveOpts,
): Promise<LlmModelChoice> {
  const choice = await resolveLlmWithModel({
    ...opts,
    message: slotMessage(slot, opts?.message),
    ...savedSeedForSlot(slot),
  });
  saveLlmSlot(slot, choice);
  return choice;
}
