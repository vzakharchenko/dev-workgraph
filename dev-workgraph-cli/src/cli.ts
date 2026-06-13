#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { authors, type AuthorsOptions } from "./actions/authors.js";
import { commitGroup, type CommitGroupOptions } from "./actions/commit-group.js";
import { exportCommits, type ExportOptions } from "./actions/export.js";
import { summarize, type SummarizeOptions } from "./actions/summarize.js";

/**
 * Collects a repeatable CLI option into an array.
 * @param value - The latest value parsed from the flag.
 * @param previous - Values gathered from earlier occurrences.
 */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

// 📌 Initialize CLI
export const program = new Command();

program
  .name("dev-workgraph")
  .description("Reconstruct forgotten engineering work from Git history.")
  .version("1.0.0");

// ✅ Command: select which author identities are the user's own work
program
  .command("authors")
  .description("List commit authors by email and select which are your own work.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--email <email>", "Pre-select an author email (repeatable, non-interactive)", collect, [])
  .option("--json", "Print authors as JSON and exit without saving")
  .action(async (repo: string, opts: { email: string[]; json?: boolean }) => {
    const options: AuthorsOptions = {
      repo,
      email: opts.email,
      json: opts.json,
    };
    try {
      await authors(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// ✅ Command: export commits + patches + deterministic JSON for your work
program
  .command("export")
  .description("Export your commits as patches and deterministic JSON.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--email <email>", "Override saved author selection (repeatable)", collect, [])
  .option("--force", "Re-export and overwrite commits that already exist")
  .action(async (repo: string, opts: { email: string[]; force?: boolean }) => {
    const options: ExportOptions = {
      repo,
      email: opts.email,
      force: opts.force,
    };
    try {
      await exportCommits(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// ✅ Command: add the model interpretation layer via a local Ollama model
program
  .command("summarize")
  .description("Summarize a repository's exported patches with a local Ollama model.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Re-summarize commits that already have a model layer")
  .option("--limit <n>", "Only process the first N pending commits", (v) => Number.parseInt(v, 10))
  .action(
    async (
      repo: string,
      opts: { url?: string; model?: string; force?: boolean; limit?: number },
    ) => {
      const options: SummarizeOptions = {
        repo,
        url: opts.url,
        model: opts.model,
        force: opts.force,
        limit: opts.limit,
      };
      try {
        await summarize(options);
      } catch (err) {
        console.error(`✖ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

// ✅ Command: group commits into work sessions and summarize each session
program
  .command("commit-group")
  .description("Group commits into work sessions and summarize each with a local model.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--days <n>", "Max days between commits before a new group (skips prompt)", (v) =>
    Number.parseInt(v, 10),
  )
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Re-group and re-summarize, overwriting existing group files")
  .option("--limit <n>", "Only summarize the first N groups (useful for trials)", (v) =>
    Number.parseInt(v, 10),
  )
  .action(
    async (
      repo: string,
      opts: { days?: number; url?: string; model?: string; force?: boolean; limit?: number },
    ) => {
      const options: CommitGroupOptions = {
        repo,
        days: opts.days,
        url: opts.url,
        model: opts.model,
        force: opts.force,
        limit: opts.limit,
      };
      try {
        await commitGroup(options);
      } catch (err) {
        console.error(`✖ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

// 🔥 Execute CLI
program.parse(process.argv);