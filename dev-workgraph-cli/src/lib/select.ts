// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import inquirer from "inquirer";
import { listModels } from "./ollama.js";

/**
 * Resolves an Ollama model: the flag if given, else an interactive picker
 * seeded from `opts.saved`. Does not persist — the caller stores it in the
 * appropriate config slot.
 * @param baseUrl - Ollama base URL.
 * @param flagModel - Value of `--model`, if any.
 * @param opts.message - Prompt message for the picker.
 * @param opts.saved - Previously chosen model to pre-select.
 */
export async function resolveModel(
  baseUrl: string,
  flagModel?: string,
  opts?: { message?: string; saved?: string },
): Promise<string> {
  const available = await listModels(baseUrl);
  if (available.length === 0) {
    throw new Error(`No models installed on Ollama at ${baseUrl}. Run \`ollama pull <model>\`.`);
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
      message: opts?.message ?? `Which Ollama model? (${baseUrl})`,
      choices: available,
      default: saved && available.includes(saved) ? saved : available[0],
    },
  ]);
  return model;
}
