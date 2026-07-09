#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { type AuthorsOptions, authors } from "./actions/authors.js";
import { type CheckOptions, check } from "./actions/check.js";
import { type CommitGroupOptions, commitGroup } from "./actions/commit-group.js";
import { type DeepenOptions, deepen } from "./actions/deepen.js";
import { type EvidenceOptions, evidence } from "./actions/evidence.js";
import { type ExportOptions, exportRepo } from "./actions/export.js";
import { type FinalOptions, final } from "./actions/final.js";
import { type ImportOptions, importRepo } from "./actions/import.js";
import { type InitOptions, init } from "./actions/init.js";
import { type PrepareOptions, prepare } from "./actions/prepare.js";
import { type ReportOptions, report } from "./actions/report.js";
import { type RunOptions, run } from "./actions/run.js";
import { type SummarizeOptions, summarize } from "./actions/summarize.js";
import { pickLlmCommandOptions, registerLlmProviderOptions } from "./lib/llm/cli-options.js";
import { NoLlmBackendsError } from "./lib/llm/install-help.js";

/**
 * Collects a repeatable CLI option into an array.
 * @param value - The latest value parsed from the flag.
 * @param previous - Values gathered from earlier occurrences.
 */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function reportActionError(err: unknown): void {
  if (err instanceof NoLlmBackendsError) {
    process.exitCode = 1;
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message) console.error(`✖ ${message}`);
  process.exitCode = 1;
}

// 📌 Initialize CLI
export const program = new Command();

program
  .name("dev-workgraph")
  .description("Reconstruct forgotten engineering work from Git history.")
  .version("1.0.0");

// ✅ Command: verify Ollama is installed/running and has models
registerLlmProviderOptions(
  program
    .command("check")
    .description("Check that the LLM backend is running and has models; suggest install if not."),
).action(async (opts: Record<string, unknown>) => {
  const options: CheckOptions = pickLlmCommandOptions(opts);
  try {
    await check(options);
  } catch (err) {
    reportActionError(err);
  }
});

// ✅ Command: capture developer role + project story → project profile
// Registered twice: `init` (repo-level) and `init:period` (scoped to a review
// window, inheriting the repo-level context by default).
function registerInit(name: string, periodMode: boolean): void {
  registerLlmProviderOptions(
    program
      .command(name)
      .description(
        periodMode
          ? "Init a review period (inherits the repo-level context)."
          : "Capture developer role and project story, build a project profile.",
      )
      .argument("[repo]", "Path to the Git repository", ".")
      .option("--role <name>", "Developer role (skips the prompt)")
      .option("--story <text>", "Project story text (skips the editor prompt)")
      .option("--period <id>", "Review period label (e.g. 2022, 2022-H1)")
      .option("--from <date>", "Period start date, ISO YYYY-MM-DD (inclusive)")
      .option("--to <date>", "Period end date, ISO YYYY-MM-DD (exclusive)"),
  )
    .option("--model <name>", "Model to use (skips the interactive picker)")
    .action(
      async (
        repo: string,
        opts: {
          role?: string;
          story?: string;
          period?: string;
          from?: string;
          to?: string;
          model?: string;
        },
      ) => {
        const options: InitOptions = {
          repo,
          role: opts.role,
          story: opts.story,
          period: opts.period,
          from: opts.from,
          to: opts.to,
          periodMode,
          ...pickLlmCommandOptions(opts),
        };
        try {
          await init(options);
        } catch (err) {
          reportActionError(err);
        }
      },
    );
}
registerInit("init", false);
registerInit("init:period", true);

// ✅ Command: select which author identities are the user's own work
program
  .command("authors")
  .description("List commit authors by email and select which are your own work.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option(
    "--email <email>",
    "Pre-select an author email (repeatable, non-interactive)",
    collect,
    [],
  )
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
      reportActionError(err);
    }
  });

// ✅ Command: extract commit evidence — patches + deterministic JSON — for your work
registerLlmProviderOptions(
  program
    .command("evidence")
    .description("Extract your commits as patches and a deterministic evidence layer.")
    .argument("[repo]", "Path to the Git repository", ".")
    .option("--email <email>", "Override saved author selection (repeatable)", collect, [])
    .option("--period <id>", "Restrict to a defined review period (scopes output too)"),
)
  .option(
    "--model <name>",
    "Model for path filter (default: narrativeModel → reportModel → commitModel)",
  )
  .option("--no-path-filter", "Disable LLM path filter for split commits with more than 15 parts")
  .action(
    async (
      repo: string,
      opts: {
        email: string[];
        period?: string;
        model?: string;
        noPathFilter?: boolean;
      },
    ) => {
      const options: EvidenceOptions = {
        repo,
        email: opts.email,
        period: opts.period,
        noPathFilter: opts.noPathFilter,
        ...pickLlmCommandOptions(opts),
      };
      try {
        await evidence(options);
      } catch (err) {
        reportActionError(err);
      }
    },
  );

// ✅ Command: add the model interpretation layer via a local Ollama model
registerLlmProviderOptions(
  program
    .command("summarize")
    .description("Summarize a repository's extracted patches with a local LLM.")
    .argument("[repo]", "Path to the Git repository", "."),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--limit <n>", "Only process the first N pending commits", (v) => Number.parseInt(v, 10))
  .option("--period <id>", "Operate on a defined review period's data")
  .action(async (repo: string, opts: { model?: string; limit?: number; period?: string }) => {
    const options: SummarizeOptions = {
      repo,
      limit: opts.limit,
      period: opts.period,
      ...pickLlmCommandOptions(opts),
    };
    try {
      await summarize(options);
    } catch (err) {
      reportActionError(err);
    }
  });

// ✅ Command: group commits into work sessions and summarize each session
registerLlmProviderOptions(
  program
    .command("commit-group")
    .description("Group commits into work sessions and summarize each with a local model.")
    .argument("[repo]", "Path to the Git repository", ".")
    .option("--days <n>", "Max days between commits before a new group (skips prompt)", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--max-commits <n>", "Max commits per group, 0 = unlimited (skips prompt)", (v) =>
      Number.parseInt(v, 10),
    ),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--limit <n>", "Only summarize the first N groups (useful for trials)", (v) =>
    Number.parseInt(v, 10),
  )
  .option("--period <id>", "Operate on a defined review period's data")
  .action(
    async (
      repo: string,
      opts: {
        days?: number;
        maxCommits?: number;
        model?: string;
        limit?: number;
        period?: string;
      },
    ) => {
      const options: CommitGroupOptions = {
        repo,
        days: opts.days,
        maxCommits: opts.maxCommits,
        limit: opts.limit,
        period: opts.period,
        ...pickLlmCommandOptions(opts),
      };
      try {
        await commitGroup(options);
      } catch (err) {
        reportActionError(err);
      }
    },
  );

// ✅ Command: fold work-session groups into a cumulative narrative report
registerLlmProviderOptions(
  program
    .command("report")
    .description("Fold work-session groups into a cumulative narrative report.")
    .argument("[repo]", "Path to the Git repository", "."),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--limit <n>", "Only fold the first N groups (useful for trials)", (v) =>
    Number.parseInt(v, 10),
  )
  .option("--period <id>", "Operate on a defined review period's data")
  .action(async (repo: string, opts: { model?: string; limit?: number; period?: string }) => {
    const options: ReportOptions = {
      repo,
      limit: opts.limit,
      period: opts.period,
      ...pickLlmCommandOptions(opts),
    };
    try {
      await report(options);
    } catch (err) {
      reportActionError(err);
    }
  });

// ✅ Command: distill the latest report into a role-aligned prepared narrative
registerLlmProviderOptions(
  program
    .command("prepare")
    .description("Distill the latest report into a single role-aligned narrative.")
    .argument("[repo]", "Path to the Git repository", "."),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--period <id>", "Operate on a defined review period's data")
  .action(async (repo: string, opts: { model?: string; period?: string }) => {
    const options: PrepareOptions = {
      repo,
      period: opts.period,
      ...pickLlmCommandOptions(opts),
    };
    try {
      await prepare(options);
    } catch (err) {
      reportActionError(err);
    }
  });

// ✅ Command: collect answers to prepared questions → RECONSTRUCTION.<project>.md
registerLlmProviderOptions(
  program
    .command("final")
    .description("Answer the prepared questions and write RECONSTRUCTION.<project>.md.")
    .argument("[repo]", "Path to the Git repository", ".")
    .option("--answers-file <path>", "Pre-written Q&A as JSON (non-interactive)")
    .option("--output <path>", "Output markdown path (default: ./RECONSTRUCTION.<project>.md)"),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--period <id>", "Operate on a defined review period's data")
  .action(
    async (
      repo: string,
      opts: {
        answersFile?: string;
        output?: string;
        model?: string;
        period?: string;
      },
    ) => {
      const options: FinalOptions = {
        repo,
        answersFile: opts.answersFile,
        output: opts.output,
        period: opts.period,
        ...pickLlmCommandOptions(opts),
      };
      try {
        await final(options);
      } catch (err) {
        reportActionError(err);
      }
    },
  );

// ✅ Command: extend latest finish with four new Q&A → refined RECONSTRUCTION
registerLlmProviderOptions(
  program
    .command("deepen")
    .description(
      "Extend the latest finish: recalled context, four new questions, refined narrative (8+ Q&A).",
    )
    .argument("[repo]", "Path to the Git repository", ".")
    .option(
      "--context-file <path>",
      "Recalled non-code project context as plain text (skips the editor prompt)",
    )
    .option(
      "--answers-file <path>",
      "Pre-written answers to the four NEW questions only (non-interactive)",
    )
    .option("--output <path>", "Output markdown path (default: ./RECONSTRUCTION.<project>.md)"),
)
  .option("--model <name>", "Model to use (skips the interactive picker)")
  .option("--period <id>", "Operate on a defined review period's data")
  .action(
    async (
      repo: string,
      opts: {
        contextFile?: string;
        answersFile?: string;
        output?: string;
        model?: string;
        period?: string;
      },
    ) => {
      const options: DeepenOptions = {
        repo,
        contextFile: opts.contextFile,
        answersFile: opts.answersFile,
        output: opts.output,
        period: opts.period,
        ...pickLlmCommandOptions(opts),
      };
      try {
        await deepen(options);
      } catch (err) {
        reportActionError(err);
      }
    },
  );

// ✅ Command: run the whole pipeline unattended (gather inputs upfront)
// Registered twice: `run` (repo-level) and `run:period` (a year/period review).
function registerRun(name: string, periodMode: boolean): void {
  registerLlmProviderOptions(
    program
      .command(name)
      .description(
        periodMode
          ? "Run the whole pipeline for a review period (init:period → … → final)."
          : "Gather all inputs, then run init → evidence → summarize → commit-group → report.",
      )
      .argument("[repo]", "Path to the Git repository", ".")
      .option("--period <id>", "Review period label (e.g. 2022, 2022-H1)")
      .option("--from <date>", "Period start date, ISO YYYY-MM-DD (inclusive)")
      .option("--to <date>", "Period end date, ISO YYYY-MM-DD (exclusive)"),
  )
    .option("--model <name>", "Model to use for every stage (skips the picker)")
    .action(
      async (
        repo: string,
        opts: {
          period?: string;
          from?: string;
          to?: string;
          model?: string;
        },
      ) => {
        const options: RunOptions = {
          repo,
          period: opts.period,
          from: opts.from,
          to: opts.to,
          periodMode,
          ...pickLlmCommandOptions(opts),
        };
        try {
          await run(options);
        } catch (err) {
          reportActionError(err);
        }
      },
    );
}
registerRun("run", false);
registerRun("run:period", true);

// ✅ Command: bundle a repo's workgraph data + config entry into a .tar.gz
program
  .command("export")
  .description("Bundle a repo's workgraph data and config entry into a .tar.gz.")
  .argument("[repo]", "Path to the Git repository", ".")
  .option("--output <path>", "Output .tar.gz path (default: ./<repo-id>.workgraph.tar.gz)")
  .action(async (repo: string, opts: { output?: string }) => {
    const options: ExportOptions = { repo, output: opts.output };
    try {
      await exportRepo(options);
    } catch (err) {
      reportActionError(err);
    }
  });

// ✅ Command: restore a bundle made by `export`, adding/updating the config entry
program
  .command("import")
  .description("Restore a workgraph .tar.gz bundle and add/update its config entry.")
  .argument("<tarball>", "Path to the .tar.gz produced by `export`")
  .option("--repo <path>", "Re-target the data under a different repo path")
  .action(async (tarball: string, opts: { repo?: string }) => {
    const options: ImportOptions = { tarball, repo: opts.repo };
    try {
      await importRepo(options);
    } catch (err) {
      reportActionError(err);
    }
  });

// 🔥 Execute CLI
program.parse(process.argv);
