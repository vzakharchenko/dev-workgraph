// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { LlmProviderId } from "./llm/types.js";
import { pathClassificationJsonSchema } from "./model.js";
import { chatJson } from "./ollama.js";
import { listPatchFilePaths } from "./patch-split.js";
import { buildPathClassifyPrompt, PATH_CLASSIFY_SYSTEM } from "./prompts.js";
import { compareLocale } from "./sort.js";

/** When a split commit exceeds this many parts, run LLM path classification on evidence export. */
export const MAX_SPLIT_PARTS_BEFORE_PATH_FILTER = 15;

/** Maximum unique file signatures sent to the classifier per LLM call. */
const PATH_CLASSIFY_BATCH_SIZE = 200;

/** LLM path classification result (full repository paths to peel from the patch). */
export interface PathClassification {
  likelyBinary: string[];
  likelyGenerated: string[];
}

/**
 * Derives a file signature for path-filter LLM input: extension (`.png`) or basename when
 * there is no extension (`Dockerfile`, `.gitignore`).
 */
export function pathSignature(repoPath: string): string {
  const normalized = repoPath.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(dot);
}

/** Maps each signature to all repository paths that share it. */
export function indexPathsBySignature(paths: readonly string[]): Map<string, string[]> {
  const bySignature = new Map<string, string[]>();
  for (const p of paths) {
    const sig = pathSignature(p);
    const list = bySignature.get(sig);
    if (list) list.push(p);
    else bySignature.set(sig, [p]);
  }
  return bySignature;
}

function filterToInput(items: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && allowed.has(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

function expandSignaturesToPaths(
  signatures: readonly string[],
  pathsBySignature: ReadonlyMap<string, string[]>,
): string[] {
  const out: string[] = [];
  for (const sig of signatures) {
    for (const p of pathsBySignature.get(sig) ?? []) {
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * Classifies paths as likely binary or auto-generated using a local Ollama model.
 * Sends unique file extensions and extensionless basenames — not full paths or diff content.
 * @param input - Endpoint, model, and path list from a split commit patch.
 */
export async function classifyPathsByFilename(input: {
  baseUrl: string;
  model: string;
  paths: string[];
  provider?: LlmProviderId;
}): Promise<PathClassification> {
  if (input.paths.length === 0) {
    return { likelyBinary: [], likelyGenerated: [] };
  }

  const pathsBySignature = indexPathsBySignature(input.paths);
  const signatures = [...pathsBySignature.keys()].sort(compareLocale);
  const allowedSignatures = new Set(signatures);

  const likelyBinarySignatures: string[] = [];
  const likelyGeneratedSignatures: string[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < signatures.length; i += PATH_CLASSIFY_BATCH_SIZE) {
    batches.push(signatures.slice(i, i + PATH_CLASSIFY_BATCH_SIZE));
  }

  for (const batch of batches) {
    const raw = (await chatJson({
      baseUrl: input.baseUrl,
      model: input.model,
      provider: input.provider,
      system: PATH_CLASSIFY_SYSTEM,
      user: buildPathClassifyPrompt(batch),
      schema: pathClassificationJsonSchema(),
      think: false,
    })) as PathClassification;

    for (const sig of filterToInput(raw.likelyBinary, allowedSignatures)) {
      if (!likelyBinarySignatures.includes(sig)) likelyBinarySignatures.push(sig);
    }
    for (const sig of filterToInput(raw.likelyGenerated, allowedSignatures)) {
      if (!likelyGeneratedSignatures.includes(sig)) likelyGeneratedSignatures.push(sig);
    }
  }

  return {
    likelyBinary: expandSignaturesToPaths(likelyBinarySignatures, pathsBySignature),
    likelyGenerated: expandSignaturesToPaths(likelyGeneratedSignatures, pathsBySignature),
  };
}

/** Collects unique paths from a patch (convenience wrapper). */
export function pathsFromPatch(patch: string): string[] {
  return listPatchFilePaths(patch);
}
