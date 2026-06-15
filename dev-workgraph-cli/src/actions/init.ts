// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import inquirer from "inquirer";
import { loadConfig, repoProjectPath, setOllamaConfig, setRepoConfig } from "../lib/config.js";
import { resolveRepo } from "../lib/git.js";
import { projectProfileJsonSchema, storyPrepareJsonSchema } from "../lib/model.js";
import { chatJson, resolveBaseUrl } from "../lib/ollama.js";
import { ROLES } from "../lib/project.js";
import {
  PROJECT_PROFILE_SYSTEM,
  STORY_PREPARE_SYSTEM,
  buildProjectProfilePrompt,
  buildStoryPreparePrompt,
} from "../lib/prompts.js";
import { resolveModel } from "../lib/select.js";
import type { ProjectContext, ProjectProfile } from "../lib/records.js";

/**
 * Options for the `init` command.
 */
export interface InitOptions {
  /** Path to the repository. */
  repo: string;
  /** Developer role; skips the role prompt. */
  role?: string;
  /** Project story text; skips the editor prompt. */
  story?: string;
  /** Ollama base URL override. */
  url?: string;
  /** Model name; skips the interactive picker. */
  model?: string;
  /** Re-run both LLM sessions and overwrite an existing project.json. */
  force?: boolean;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

/** Resolves the role: flag (validated) or interactive picker. */
export async function resolveRole(flagRole?: string): Promise<string> {
  if (flagRole) {
    if (!(ROLES as readonly string[]).includes(flagRole)) {
      throw new Error(`Unknown role "${flagRole}". Choose one of: ${ROLES.join(", ")}`);
    }
    return flagRole;
  }
  const { role } = await inquirer.prompt<{ role: string }>([
    { type: "select", name: "role", message: "Your role on this project:", choices: [...ROLES] },
  ]);
  return role;
}

/** Resolves the project story: flag or editor prompt. */
export async function resolveStory(flagStory?: string): Promise<string> {
  if (flagStory !== undefined) return flagStory;
  const { story } = await inquirer.prompt<{ story: string }>([
    {
      type: "editor",
      name: "story",
      message:
        "Describe the project (what it is, how it started, key events / pivots / milestones):",
    },
  ]);
  return (story ?? "").trim();
}

/**
 * Captures the developer's role and project story, then builds a project
 * profile via two LLM sessions, writing `project.json`.
 * @param options - Resolved command options.
 */
export async function init(options: InitOptions): Promise<void> {
  const repoPath = resolveRepo(options.repo);
  const file = repoProjectPath(repoPath);

  if (!options.force && fs.existsSync(file)) {
    console.log(`Project already initialized (${file}). Use --force to redo.`);
    return;
  }

  const role = await resolveRole(options.role);
  setRepoConfig(repoPath, { role });
  const story = await resolveStory(options.story);

  const readmePath = path.join(repoPath, "README.md");
  const readmePresent = fs.existsSync(readmePath);
  const readme = readmePresent ? fs.readFileSync(readmePath, "utf8") : "";

  const baseUrl = resolveBaseUrl(options.url);
  const savedOllama = loadConfig().ollama;
  const model = await resolveModel(baseUrl, options.model, {
    message: "Which Ollama model should prepare project context?",
    saved: savedOllama?.reportModel ?? savedOllama?.model,
  });
  setOllamaConfig({ baseUrl, reportModel: model });
  console.log(`\nPreparing project context for a ${role} with "${model}"...`);

  // Session 1 — reframe the raw story for the role.
  const prepared = (await chatJson({
    baseUrl,
    model,
    system: STORY_PREPARE_SYSTEM,
    user: buildStoryPreparePrompt(role, story),
    schema: storyPrepareJsonSchema(),
  })) as { preparedContext?: string };
  const preparedContext = prepared.preparedContext?.trim() ?? "";

  // Session 2 — build a structured project profile.
  const rawProfile = (await chatJson({
    baseUrl,
    model,
    system: PROJECT_PROFILE_SYSTEM,
    user: buildProjectProfilePrompt(role, preparedContext, readme),
    schema: projectProfileJsonSchema(),
  })) as Record<string, unknown>;

  const profile: ProjectProfile = {
    summary: typeof rawProfile.summary === "string" ? rawProfile.summary : "",
    domains: asStringArray(rawProfile.domains),
    apparentStack: asStringArray(rawProfile.apparentStack),
    keyThemes: asStringArray(rawProfile.keyThemes),
  };

  const context: ProjectContext = {
    role,
    story: { raw: story, preparedContext },
    readme: readmePresent ? { present: true, path: "README.md" } : { present: false },
    profile,
    provenance: { model, generatedAt: new Date().toISOString() },
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(context, null, 2)}\n`, "utf8");

  console.log(`\n✅ Project initialized: ${file}`);
  console.log(`   Role: ${role} · README: ${readmePresent ? "found" : "none"}`);
  console.log(`   Profile: ${profile.summary || "(empty)"}`);
}
