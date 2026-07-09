// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { getProviderKind } from "./llm/providers.js";
import type { LlmModelChoice } from "./llm/types.js";

/**
 * Runs a pipeline step with provider session boundaries when the kind requires it
 * (e.g. LM Studio: unload all → load → unload in `finally`).
 */
export async function withProviderStep<T>(
  choice: LlmModelChoice,
  fn: () => Promise<T>,
): Promise<T> {
  const kind = getProviderKind(choice.providerId);
  if (kind.needsStepLifecycle && kind.prepareStep) {
    await kind.prepareStep(choice.baseUrl, choice.model);
  }
  try {
    return await fn();
  } finally {
    if (kind.needsStepLifecycle && kind.releaseStep) {
      await kind.releaseStep(choice.baseUrl);
    }
  }
}
