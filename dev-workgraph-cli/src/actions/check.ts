// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { listModels, resolveBaseUrl } from "../lib/ollama.js";

/**
 * Options for the `check` command.
 */
export interface CheckOptions {
  /** Ollama base URL override. */
  url?: string;
}

/** Suggested models to pull when none are installed. */
const SUGGESTED_MODELS = ["qwen2.5-coder:14b", "gpt-oss:latest"];

/** True when the `ollama` binary is on PATH. */
function ollamaInstalled(): boolean {
  try {
    execFileSync("ollama", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Prints OS-specific install instructions (macOS / Linux, with a generic fallback). */
function printInstallHelp(): void {
  console.log("\nHow to install Ollama:");
  if (process.platform === "darwin") {
    console.log("  macOS:  brew install ollama");
    console.log("          (or download the app: https://ollama.com/download)");
    console.log("  Start:  ollama serve     (or open the Ollama app)");
  } else if (process.platform === "linux") {
    console.log("  Linux:  curl -fsSL https://ollama.com/install.sh | sh");
    console.log("  Start:  ollama serve");
  } else {
    console.log("  Download: https://ollama.com/download");
    console.log("  Start:    ollama serve");
  }
  console.log("\nThen pull a model, e.g.:");
  for (const m of SUGGESTED_MODELS) console.log(`  ollama pull ${m}`);
}

/**
 * Verifies Ollama is reachable and has at least one model, printing install /
 * pull guidance on failure. Returns true when ready. Reused as a `run` preflight.
 * @param baseUrl - Resolved Ollama base URL.
 */
export async function ollamaReady(baseUrl: string): Promise<boolean> {
  let models: string[];
  try {
    models = await listModels(baseUrl);
  } catch (err) {
    console.log(`✖ Cannot reach Ollama at ${baseUrl} (${(err as Error).message}).`);
    if (ollamaInstalled()) {
      console.log("Ollama is installed but not responding — start the server: `ollama serve`");
    } else {
      console.log("Ollama does not appear to be installed.");
      printInstallHelp();
    }
    return false;
  }

  if (models.length === 0) {
    console.log(`⚠️  Ollama is running at ${baseUrl}, but no models are installed.`);
    console.log("\nPull a model, e.g.:");
    for (const m of SUGGESTED_MODELS) console.log(`  ollama pull ${m}`);
    return false;
  }

  console.log(`✅ Ollama is running with ${models.length} model(s):`);
  for (const m of models) console.log(`   • ${m}`);
  return true;
}

/**
 * Checks that Ollama is reachable and has models, then reports saved model
 * preferences and flags any that are missing.
 * @param options - Resolved command options.
 */
export async function check(options: CheckOptions): Promise<void> {
  const baseUrl = resolveBaseUrl(options.url);
  console.log(`Checking Ollama at ${baseUrl} ...`);

  if (!(await ollamaReady(baseUrl))) {
    process.exitCode = 1;
    return;
  }

  const models = await listModels(baseUrl);
  const ollama = loadConfig().ollama;
  const saved: [string, string | undefined][] = [
    ["commitModel", ollama?.commitModel],
    ["reportModel", ollama?.reportModel],
    ["narrativeModel", ollama?.narrativeModel],
  ];
  for (const [slot, m] of saved) {
    if (m) console.log(`   ${slot}: ${m}${models.includes(m) ? "" : "  (NOT installed)"}`);
  }
  const missing = saved.filter(([, m]) => m && !models.includes(m));
  if (missing.length > 0) {
    console.log("\n⚠️  Saved model(s) not installed — pull them or re-pick on the next run:");
    for (const [, m] of missing) console.log(`  ollama pull ${m}`);
    process.exitCode = 1;
  }
}
