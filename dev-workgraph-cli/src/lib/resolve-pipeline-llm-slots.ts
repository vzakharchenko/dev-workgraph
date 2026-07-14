// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { LlmCommandOptions } from "./llm/cli-options.js";
import type { LlmModelChoice } from "./llm/types.js";
import { discoverLlmBackends, noLlmBackendsError } from "./ollama.js";
import { resolveLlmSlot } from "./select.js";

/** LLM choices for the three pipeline stages (same slots as `run`). */
export interface PipelineLlmSlots {
  commit: LlmModelChoice;
  report: LlmModelChoice;
  narrative: LlmModelChoice;
}

/**
 * Interactive model selection for commit, report, and narrative stages.
 * Used by `run` and `migrate` with the same prompts.
 */
export async function resolvePipelineLlmSlots(
  options: LlmCommandOptions,
): Promise<PipelineLlmSlots> {
  const shared = {
    ollama: options.ollama,
    lmstudio: options.lmstudio,
    model: options.model?.trim() || undefined,
  };

  const backends = await discoverLlmBackends(shared);
  if (backends.length === 0) {
    throw noLlmBackendsError();
  }

  console.log(
    "\nSelect a model for each pipeline stage (Ollama and LM Studio models appear together).\n",
  );

  const commit = await resolveLlmSlot("commit", {
    ...shared,
    message: "Model for commit summaries & commit-group?",
  });
  const report = await resolveLlmSlot("report", {
    ...shared,
    message: "Model for report?",
  });
  const narrative = await resolveLlmSlot("narrative", {
    ...shared,
    message: "Model for project context (init), prepare & final?",
  });

  return { commit, report, narrative };
}
