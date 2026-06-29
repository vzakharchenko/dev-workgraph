# dev-workgraph

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=bugs)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=coverage)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph)

[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=vzakharchenko_dev-workgraph&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=vzakharchenko_dev-workgraph) 


[![REUSE status](https://api.reuse.software/badge/github.com/vzakharchenko/dev-workgraph)](https://api.reuse.software/info/github.com/vzakharchenko/dev-workgraph)

**Turn a Git repository into a career story you can defend** — for a performance review, a CV, or interview prep.

You point the CLI at a repo where you actually worked. It reads your commits and patches, asks what Git cannot know, you confirm the missing context, and it writes **`RECONSTRUCTION.<project>.md`**: what you did, where in the system, and what impact means for **your role** (Principal, Staff, Senior, Junior) — with role narrative bullets and CV bullets grounded in evidence, not a blank ChatGPT prompt.

## Why this exists

**The problem.** Sooner or later you must explain your work — at a half-yearly or annual review, on a resume, to a recruiter, to an ATS, or for a project you shipped years ago. You were busy — but memory fades. Git remembers *diffs*; it does not remember *why*, *whether it shipped*, *who owned the design*, or *how it maps to impact*. Generic AI can polish prose, but it invents or drifts because it never saw your repo or your answers.

**What dev-workgraph does instead.** It **reconstructs** work from **your** Git history plus **your** confirmations:

| You need to… | What you get |
|--------------|--------------|
| **Performance review** | First-person **Your IMPACT**, four role-framed bullets, technologies — tied to commits and signals from the period |
| **CV / resume** | Four impersonal **CV bullets** with real stack and architecture keywords from the codebase |
| **Interview prep** | A readable narrative of what you built and **Possible questions** with your own answers — ownership, production, design vs implementation |

This is **not** a commit counter, activity heatmap, or auto-scored achievement tool. It does **not** claim customer impact or production usage unless **you** stated that in an answer.

**How it works (short).**

1. **Evidence** — your commits → patches, areas, work sessions, technical/architecture signals.
2. **Ask** — up to four role-aware questions per round (what Git cannot infer).
3. **Confirm** — you answer; answers are stored on the finish archive, separate from the prepared narrative.
4. **Deliver** — `RECONSTRUCTION.<project>.md` (+ optional `.v2.md` after **`deepen`** when you recall more team context, pivots, or review framing).

See real outputs on GitHub: [Forge Secure Notes for Jira](https://github.com/vzakharchenko/dev-workgraph/blob/master/examples/Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) (Principal) and [keycloak-radius-plugin](https://github.com/vzakharchenko/dev-workgraph/blob/master/examples/keycloak-radius-plugin/RECONSTRUCTION.keycloak-radius-plugin.v2.md) (Staff, open-source IAM).

### Evidence pipeline, not a resume generator

The goal is **not** “generate a resume from Git.” dev-workgraph builds an **evidence-based career reconstruction pipeline**:

- **Deterministic layer** (commits, patches, file paths, timestamps) stays separate from **model-generated** summaries and narratives — so evidence is stable when models or prompts change.
- Raw Git activity is converted into **structured signals** (technical, architecture, security) and ranked context (high / medium / low); maintenance noise (dependency bumps, releases) is deprioritized so design work is not drowned out.
- A **feedback loop** closes the gap Git cannot fill: the tool finds missing intent in the evidence, asks targeted questions, and stores your answers as a separate context layer that reframes activity into **role-based impact**.
- Final claims are grounded in **verified inputs** — repository data, commits, generated evidence, and human corrections — making the output easier to defend in a review or interview than a generic AI narrative.

Under the hood, the pipeline builds a **work graph** from Git history and your answers: commits, sessions, reports, questions, and Q&A linked by provenance. The RECONSTRUCTION is a fold over that graph — every claim traceable to evidence or a confirmed answer. That graph is also the foundation for safe **retrieval** (RAG) over your own work later: retrieval first, generation on a corpus you can defend.

## Install

```bash
# run on demand, no install
npx dev-workgraph run .

# or install globally for a persistent `dev-workgraph` command
npm install -g dev-workgraph
```

This provides the `dev-workgraph` command. You also need [Ollama](https://ollama.com) running locally (see [Quick start](#quick-start)).

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org) 20+, Git, and [Ollama](https://ollama.com) running locally.

```bash
brew install ollama
ollama pull qwen2.5-coder:14b
ollama pull gpt-oss:latest
ollama pull gemma4:31b
ollama serve
```

```bash
cd /path/to/your/repo
npx dev-workgraph run .
```

The pipeline ends with **`final`**: you answer up to four questions interactively. The markdown deliverable is written to your **current working directory**. Everything before that can run unattended and be resumed.

## Example outputs

Real **`RECONSTRUCTION.*.md`** files from dogfooding on production repos (local Ollama, interactive `final` + **`deepen`**):

| Project | Role | Output |
|---------|------|--------|
| [Forge Secure Notes for Jira](https://github.com/ForgeRock/Forge-Secure-Notes-for-Jira) | Principal Developer | [RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md](https://github.com/vzakharchenko/dev-workgraph/blob/master/examples/Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) — zero-trust Jira Forge app, encryption, ~300 commits |
| [keycloak-radius-plugin](https://github.com/vzakharchenko/keycloak-radius-plugin) | Staff Developer | [RECONSTRUCTION.keycloak-radius-plugin.v2.md](https://github.com/vzakharchenko/dev-workgraph/blob/master/examples/keycloak-radius-plugin/RECONSTRUCTION.keycloak-radius-plugin.v2.md) — open-source Keycloak RADIUS plugin, IAM / platform migrations |

More examples: [examples/](https://github.com/vzakharchenko/dev-workgraph/tree/master/examples) on GitHub.

## Review periods

Doing a **periodic review** (“what did I do in 2024?”)? Scope the whole pipeline to a date window with `--period`:

```bash
npx dev-workgraph init:period ./repo --period 2024 --from 2024-01-01 --to 2025-01-01
npx dev-workgraph run:period  ./repo --period 2024
```

The deliverable is `RECONSTRUCTION.<project>.2024.md` — a period review does not overwrite your all-time reconstruction. Every pipeline command accepts `--period <id>`.

## How it runs

**Local only** — Ollama on your machine. No cloud API; analysis stays under `~/.workgraph/` unless you `export` a bundle yourself.

**Resumable** — stop anytime before `final`; re-run `npx dev-workgraph run .` and completed commits, groups, and report folds are skipped. Interactive Q&A starts only after `prepare`.

**Dogfooded** on **MacBook Pro M4 Pro (48 GB)**. One real repo (**~300 commits**): unattended stages took **~6 hours** before the first questions (`final`). Time depends on models, patch size, and cache from prior runs.

### Recommended Ollama models

Use strong models for real runs — weak ones work for smoke tests but hurt long reports.

| Slot | Model | Used for |
|------|--------|----------|
| `commitModel` | `qwen2.5-coder:14b` | `summarize`, `commit-group` |
| `reportModel` | `gpt-oss:latest` | `report` |
| `narrativeModel` | `gemma4:31b` | `init`, `prepare`, `final`, `deepen` |

`run` saves the three slots in `~/.workgraph/config.json`.

## Pipeline

| Stage | Command | LLM | What it does |
|-------|---------|-----|--------------|
| Preflight | `check` | — | Ollama reachable, models installed |
| Authors | `authors` | — | Select your commit emails |
| Context | `init` | narrative | Role, project story, README → `project.json` |
| Evidence | `evidence` | — | Patches + deterministic JSON per commit |
| Commit layer | `summarize` | commit | Per-commit summary, signals, questions |
| Sessions | `commit-group` | commit | Group by day gap; session history |
| Cumulative | `report` | report | Fold groups → growing narrative report |
| Distill | `prepare` | narrative | One history + up to 4 questions for `final` |
| Deliver | `final` | narrative | **You answer** → `RECONSTRUCTION.<project>.md` |
| Extend | `deepen` | narrative | Recalled context + 4 new Q&A → `.v2.md`, … |

`run` executes everything through `final`. `deepen` is **not** part of `run` — run it separately when you remember more context.

## Commands

```bash
dev-workgraph check
dev-workgraph init         ./repo
dev-workgraph authors      ./repo
dev-workgraph evidence     ./repo
dev-workgraph summarize    ./repo
dev-workgraph commit-group ./repo
dev-workgraph report       ./repo
dev-workgraph prepare      ./repo
dev-workgraph final        ./repo
dev-workgraph deepen       ./repo
dev-workgraph run          ./repo
dev-workgraph export       ./repo
dev-workgraph import       <bundle.tar.gz>
dev-workgraph init:period  ./repo --period 2024 --from 2024-01-01 --to 2025-01-01
dev-workgraph run:period   ./repo --period 2024
```

Common flags:

- `--period <id>` — scope to a review window (`periods/<id>/` data subtree)
- `--model <name>` — force Ollama model for this command
- `--url <url>` — Ollama base URL (default `http://127.0.0.1:11434`)
- `final --answers-file <path>` — non-interactive answers (JSON)
- `final --output <path>` — override markdown path
- `deepen --context-file <path>` — non-interactive recalled context

## On-disk data

All analysis is namespaced per repository under `~/.workgraph/data/repos/<repo-id>/`:

```
project.json
commits/<ts>/<hash>.{patch,json}     # evidence (deterministic)
summaries/<ts>/<hash>.json           # commit model layer
groups/<timestampEnd>.json
reports/<reportId>.json
prepared/<reportId>.json             # questions only — no answers
finish/
  <id>.json                          # finish archive
  <id>.question.json                 # v1 questions
  <id>.v2.json / .question.v2.json   # deepen / extension
  <id>.md
```

`<repo-id>` is `<basename>-<hash8>` from the absolute repo path. Config (authors, role, models) lives in `~/.workgraph/config.json`.

### Q&A storage

Human answers live on the **finish** chain, not in `prepared/`:

- **Question text** — `finish/<id>.question.json` (or `.question.vN.json`); each question has a Unix-ms `id`
- **Answers** — `finish/<id>.json` → `{ questionId, answer }[]` (cumulative)
- **Rounds** — `sourceQuestions: { "<finishId>": ["v1", "v2", …] }` on the finish record

## Portability

```bash
dev-workgraph export ./repo
dev-workgraph import ./bundle.workgraph.tar.gz --repo /new/path
```

Bundles data directory + config entry. No LLM calls.

## Core principle

```
Git patches     = evidence (trustworthy)
Model summaries = interpretation (may be wrong; must cite reasons)
Questions       = what Git cannot know
Your answers    = confirmed context (not proof unless you stated it)
RECONSTRUCTION  = personal artifact for review / interview prep — not auto-scored
```

## Development

From a git checkout of this package:

```bash
npm install
npm run build
npm test
npm run verify
npm link   # optional: global dev-workgraph command
```

## License

Apache-2.0
