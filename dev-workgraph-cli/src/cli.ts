#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { authors, type AuthorsOptions } from "./actions/authors.js";
import { check, type CheckOptions } from "./actions/check.js";
import { commitGroup, type CommitGroupOptions } from "./actions/commit-group.js";
import { evidence, type EvidenceOptions } from "./actions/evidence.js";
import { final, type FinalOptions } from "./actions/final.js";
import { init, type InitOptions } from "./actions/init.js";
import { prepare, type PrepareOptions } from "./actions/prepare.js";
import { report, type ReportOptions } from "./actions/report.js";
import { run, type RunOptions } from "./actions/run.js";
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

// ✅ Command: verify Ollama is installed/running and has models
program
  .command("check")
  .description("Check that Ollama is running and has models; suggest install if not.")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .action(async (opts: { url?: string }) => {
    const options: CheckOptions = { url: opts.url };
    try {
      await check(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// ✅ Command: capture developer role + project story → project profile
program
  .command("init")
  .description("Capture developer role and project story, build a project profile.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--role <name>", "Developer role (skips the prompt)")
  .option("--story <text>", "Project story text (skips the editor prompt)")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Re-run and overwrite an existing project.json")
  .action(
    async (
      repo: string,
      opts: { role?: string; story?: string; url?: string; model?: string; force?: boolean },
    ) => {
      const options: InitOptions = {
        repo,
        role: opts.role,
        story: opts.story,
        url: opts.url,
        model: opts.model,
        force: opts.force,
      };
      try {
        await init(options);
      } catch (err) {
        console.error(`✖ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

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

// ✅ Command: extract commit evidence — patches + deterministic JSON — for your work
program
  .command("evidence")
  .description("Extract your commits as patches and a deterministic evidence layer.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--email <email>", "Override saved author selection (repeatable)", collect, [])
  .option("--force", "Re-extract and overwrite commits that already exist")
  .action(async (repo: string, opts: { email: string[]; force?: boolean }) => {
    const options: EvidenceOptions = {
      repo,
      email: opts.email,
      force: opts.force,
    };
    try {
      await evidence(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// ✅ Command: add the model interpretation layer via a local Ollama model
program
  .command("summarize")
  .description("Summarize a repository's extracted patches with a local Ollama model.")
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
  .option("--max-commits <n>", "Max commits per group, 0 = unlimited (skips prompt)", (v) =>
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
      opts: {
        days?: number;
        maxCommits?: number;
        url?: string;
        model?: string;
        force?: boolean;
        limit?: number;
      },
    ) => {
      const options: CommitGroupOptions = {
        repo,
        days: opts.days,
        maxCommits: opts.maxCommits,
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

// ✅ Command: fold work-session groups into a cumulative narrative report
program
  .command("report")
  .description("Fold work-session groups into a cumulative narrative report.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Rebuild the report chain even if a final report exists")
  .option("--limit <n>", "Only fold the first N groups (useful for trials)", (v) =>
    Number.parseInt(v, 10),
  )
  .action(
    async (repo: string, opts: { url?: string; model?: string; force?: boolean; limit?: number }) => {
      const options: ReportOptions = {
        repo,
        url: opts.url,
        model: opts.model,
        force: opts.force,
        limit: opts.limit,
      };
      try {
        await report(options);
      } catch (err) {
        console.error(`✖ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

// ✅ Command: distill the latest report into a role-aligned prepared narrative
program
  .command("prepare")
  .description("Distill the latest report into a single role-aligned narrative.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Regenerate even if a prepared narrative for the latest report exists")
  .action(async (repo: string, opts: { url?: string; model?: string; force?: boolean }) => {
    const options: PrepareOptions = { repo, url: opts.url, model: opts.model, force: opts.force };
    try {
      await prepare(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// ✅ Command: collect answers to prepared questions → RESUME.<project>.md
program
  .command("final")
  .description("Answer the prepared questions and write RESUME.<project>.md.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--answers-file <path>", "Pre-written Q&A as JSON (non-interactive)")
  .option("--output <path>", "Output markdown path (default: ./RESUME.<project>.md)")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--force", "Re-answer the questions and overwrite the markdown")
  .action(
    async (
      repo: string,
      opts: { answersFile?: string; output?: string; url?: string; model?: string; force?: boolean },
    ) => {
      const options: FinalOptions = {
        repo,
        answersFile: opts.answersFile,
        output: opts.output,
        url: opts.url,
        model: opts.model,
        force: opts.force,
      };
      try {
        await final(options);
      } catch (err) {
        console.error(`✖ ${(err as Error).message}`);
        process.exitCode = 1;
      }
    },
  );

// ✅ Command: run the whole pipeline unattended (gather inputs upfront)
program
  .command("run")
  .description("Gather all inputs, then run init → evidence → summarize → commit-group → report.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--url <url>", "Ollama base URL (default: $OLLAMA_HOST or http://127.0.0.1:11434)")
  .option("--model <name>", "Model to use for every stage (skips the picker)")
  .option("--force", "Re-gather inputs and re-run every stage")
  .action(async (repo: string, opts: { url?: string; model?: string; force?: boolean }) => {
    const options: RunOptions = {
      repo,
      url: opts.url,
      model: opts.model,
      force: opts.force,
    };
    try {
      await run(options);
    } catch (err) {
      console.error(`✖ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

// 🔥 Execute CLI
program.parse(process.argv);