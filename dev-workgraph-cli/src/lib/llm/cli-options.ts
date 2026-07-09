// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { Command } from "commander";
import { LLM_PROVIDER_KINDS, pickLlmUrlOverrides } from "./providers.js";
import type { LlmUrlOverrides } from "./types.js";

/** LLM URL / model fields parsed from CLI and passed into actions. */
export type LlmCommandOptions = LlmUrlOverrides & {
  model?: string;
};

/** Registers per-provider `--<id>-url` flags on a Commander command. */
export function registerLlmProviderOptions(command: Command): Command {
  for (const kind of LLM_PROVIDER_KINDS) {
    command.option(kind.cliUrlOption, kind.cliUrlDescription);
  }
  return command;
}

export function pickLlmCommandOptions(opts: Record<string, unknown>): LlmCommandOptions {
  const model = opts.model;
  return {
    ...pickLlmUrlOverrides(opts),
    ...(typeof model === "string" ? { model } : {}),
  };
}
