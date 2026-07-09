// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { LLM_PROVIDER_KINDS } from "./providers.js";

/** Prints install/start instructions when neither backend has models available. */
export function printNoLlmBackendsHelp(): void {
  console.log("\nNo LLM backend is reachable with models loaded.\n");
  for (const kind of LLM_PROVIDER_KINDS) {
    kind.printInstallHelp();
  }
  const flagHints = LLM_PROVIDER_KINDS.map((k) => k.cliUrlOption.split(" ")[0]).join(" / ");
  console.log(`\nOr pass ${flagHints} and --model explicitly.`);
}

/** Prints help and returns an error with no message (CLI skips the ✖ line). */
export function noLlmBackendsError(): Error {
  printNoLlmBackendsHelp();
  return new Error("");
}
