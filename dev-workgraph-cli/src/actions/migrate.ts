// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { resolveRepo } from "../lib/git.js";
import type { LlmCommandOptions } from "../lib/llm/cli-options.js";
import { buildMigrationContext, migrateRepo } from "../lib/migrations/index.js";
import { resolvePipelineLlmSlots } from "../lib/resolve-pipeline-llm-slots.js";

export interface MigrateOptions extends LlmCommandOptions {
  repo: string;
  period?: string;
  dryRun?: boolean;
  backup?: boolean;
  /** Skip LLM lineage backfill (structural migration only). */
  skipLlm?: boolean;
}

/**
 * Migrates on-disk pipeline artifacts to the current schema version chain.
 * Order: groups → reports → prepared → finish questions → finish archives → LLM lineage backfill.
 */
export async function migrate(options: MigrateOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const ctx = buildMigrationContext(repoPath, {
    period: options.period,
    dryRun: options.dryRun,
    backup: options.backup,
  });

  console.log(
    `Migrating pipeline artifacts for ${repoPath}${options.period ? ` (${options.period})` : ""}…`,
  );
  if (options.dryRun) console.log("(dry run — no files will be written)");
  if (options.skipLlm) console.log("(skip LLM — structural migration only)");

  if (!options.skipLlm && !options.dryRun) {
    ctx.llmSlots = await resolvePipelineLlmSlots(options);
  }

  const report = await migrateRepo(ctx);

  console.log("\n── Summary ──");
  const changed = report.files.filter((f) => f.changed);
  const byKind = new Map<string, number>();
  for (const entry of changed) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }

  for (const [kind, count] of byKind) {
    console.log(`  ${kind}: ${count} file(s) migrated`);
  }

  if (changed.length === 0 && report.errors.length === 0) {
    console.log("  (all artifacts already up to date)");
  }

  for (const err of report.errors) {
    console.error(`  ✖ ${err.file}: ${err.message}`);
  }

  if (report.errors.length > 0) {
    throw new Error(`Migration failed for ${report.errors.length} file(s)`);
  }

  console.log("\nDone.");
}
