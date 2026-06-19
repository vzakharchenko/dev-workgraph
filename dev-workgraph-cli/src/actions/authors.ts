// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import inquirer from "inquirer";
import { getRepoConfig, setRepoConfig } from "../lib/config.js";
import { type Author, currentUserEmail, getAuthors, resolveRepo } from "../lib/git.js";

/**
 * Options for the `authors` command.
 */
export interface AuthorsOptions {
  /** Path to the repository (relative or absolute). */
  repo: string;
  /** Pre-select these emails non-interactively (skips the prompt). */
  email?: string[];
  /** Print the author list as JSON and exit without saving. */
  json?: boolean;
}

/**
 * Determines which emails should start pre-checked in the prompt:
 * any previously saved selection, plus the repo's configured user.email.
 */
function defaultSelection(repoPath: string, authors: Author[]): Set<string> {
  const saved = getRepoConfig(repoPath)?.selectedAuthors ?? [];
  const selected = new Set(saved.map((e) => e.toLowerCase()));

  const me = currentUserEmail(repoPath)?.toLowerCase();
  if (me && authors.some((a) => a.email === me)) {
    selected.add(me);
  }
  return selected;
}

/**
 * Scans the repository's history, lets the user pick which author emails are
 * their own work, and persists that selection for later commands.
 * @param options - Resolved command options.
 */
export async function authors(options: AuthorsOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const all = getAuthors(repoPath);

  if (all.length === 0) {
    console.log("No commits found in this repository.");
    return;
  }

  // --json: machine-readable listing, no prompt, no write.
  if (options.json) {
    console.log(JSON.stringify({ repo: repoPath, authors: all }, null, 2));
    return;
  }

  // --email: non-interactive selection.
  if (options.email && options.email.length > 0) {
    const wanted = new Set(options.email.map((e) => e.toLowerCase()));
    const known = all.filter((a) => wanted.has(a.email));
    const unknown = [...wanted].filter((e) => !all.some((a) => a.email === e));

    if (unknown.length > 0) {
      console.log(`⚠️  Not found in history, ignored: ${unknown.join(", ")}`);
    }
    if (known.length === 0) {
      console.log("No matching authors selected; nothing saved.");
      return;
    }
    persist(repoPath, known);
    return;
  }

  // Interactive selection.
  const preChecked = defaultSelection(repoPath, all);
  const { picked } = await inquirer.prompt<{ picked: string[] }>([
    {
      type: "checkbox",
      name: "picked",
      message: "Select the author identities that are YOUR work:",
      pageSize: 20,
      choices: all.map((a) => ({
        name: `${a.name} <${a.email}>  (${a.commits} commit${a.commits === 1 ? "" : "s"})`,
        value: a.email,
        checked: preChecked.has(a.email),
      })),
    },
  ]);

  if (picked.length === 0) {
    console.log("No authors selected; nothing saved.");
    return;
  }

  persist(
    repoPath,
    all.filter((a) => picked.includes(a.email)),
  );
}

/**
 * Saves the selected authors to config and prints a short confirmation.
 * @param repoPath - Absolute repository path.
 * @param selected - The chosen authors.
 */
function persist(repoPath: string, selected: Author[]): void {
  const emails = selected.map((a) => a.email);
  setRepoConfig(repoPath, { selectedAuthors: emails });

  const totalCommits = selected.reduce((sum, a) => sum + a.commits, 0);
  console.log(`\n✅ Saved ${emails.length} author identity(ies) for ${repoPath}`);
  for (const a of selected) {
    console.log(`   • ${a.name} <${a.email}>  (${a.commits})`);
  }
  console.log(`   ${totalCommits} commit(s) will be treated as your work.`);
}
