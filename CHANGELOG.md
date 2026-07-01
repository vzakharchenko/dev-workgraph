# Changelog

All notable changes to **dev-workgraph** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - NEXT RELEASE

## [1.0.2] - 2026-07-01

Large commits, noise filtering, and long Ollama runs.

### Added

#### Evidence — patch splitting

After noise filtering, patches over **24 000 characters** (`MAX_PATCH_CHARS`) are split on **file boundaries** instead of one monolithic `.patch`.

| On disk | Role |
|---------|------|
| `commits/<ts>/<hash>.json` | Manifest (`split`, `partCount`) + full-commit deterministic |
| `commits/<ts>/<hash>.partN.json` | Scoped deterministic for part N |
| `commits/<ts>/<hash>.partN.patch` | Patch slice for part N |

A single oversized file may be truncated inside its own part (`patchTruncated: true` on that part record only).

#### Evidence — noise filtering

Ignore profiles (JavaScript/TypeScript and Java) remove generated/vendored hunks **before** export and split. Dropped paths are listed in `deterministic.excludedFiles` (nothing is hidden silently).

#### Summarize — split commit (6 steps, automatic)

Large commits run inside `summarize` — no separate command:

| Step | LLM | Output |
|------|-----|--------|
| 1. Summarize parts | yes × N | `summaries/<ts>/<hash>.partN.json` |
| 2. Merge | no | `summaries/<ts>/<hash>.merge.json` |
| 3. Polish `signalReasons` | yes | (in memory) |
| 4. Compose `summary` | yes | (in memory) |
| 5. Reframe `questionsAnalysis` (4 items) | yes | (in memory) |
| 6. Write canonical | no | `summaries/<ts>/<hash>.json` |

Existing `.partN.json` / `.merge.json` files are reused on re-run; only missing steps run until the canonical file exists.

#### Summarize — empty / noise-only patches

If the patch has no `diff --git` hunks after filtering, summarize **skips the LLM**, writes an empty model layer, and sets `provenance.model` to `"(none)"`. Console: `skipped (empty patch)`.

#### commit-group — empty summary filter

Commits with `"(none)"` provenance or a blank `summary` are excluded before `groupByGap`. The console reports how many were skipped.

### Changed

- **Separate folders:** `commits/` = deterministic evidence only; `summaries/<ts>/<hash>.json` = canonical model layer. Downstream stages join the two (legacy inlined `model` on evidence files still works when no summary file exists).
- **commit-group** reads `commits/` + canonical summaries only — not `.partN.json`, `.merge.json`, or raw `.patch` files.
- **Model provenance** is `{ model, generatedAt }` only (`patchTruncated` removed from model layers; it remains on evidence part records when a hunk was truncated).
- **Dependencies** updated: `undici` (Ollama HTTP client), `@biomejs/biome` 2.5.2, `@types/node` ^26.1, `knip` ^6.23.

### Fixed

- **Ollama timeout:** HTTP requests no longer abort after ~5 minutes on slow local models; `headersTimeout` and `bodyTimeout` are **1 hour** via undici (`summarize`, `commit-group`, and other LLM steps).
- **Large Init commits** no longer fail when a single patch exceeds LLM context — split + part summarization handles them.
- **Noise vs `changedFiles`:** filtering runs before chunking, so paths like `.env`, lockfiles, and `node_modules` do not inflate patches or disagree with `changedFiles`.

### Migration

| Goal | Action |
|------|--------|
| Re-summarize a split commit | Delete `summaries/<ts>/<hash>.json` (optionally `.partN.json` / `.merge.json`), then `summarize` |
| Re-export evidence | Delete `commits/<ts>/` for that commit, then `evidence` |

Append-only behavior is unchanged: complete exports and canonical summaries are skipped on re-run.

## [1.0.1] - 2026-06-27

First public release of the CLI, published to npm as [`dev-workgraph`](https://www.npmjs.com/package/dev-workgraph).

**Turn a Git repository into a career story you can defend** — for a performance review, a CV, or interview prep.

### Install

```bash
# run on demand
npx dev-workgraph run .

# or install globally
npm install -g dev-workgraph
```

**Prerequisites:** Node.js 20+, Git, and [Ollama](https://ollama.com) running locally.

```bash
brew install ollama
ollama pull qwen2.5-coder:14b
ollama pull gpt-oss:latest
ollama pull gemma4:31b
ollama serve
```

### Added

- **Local-only pipeline** — Ollama on your machine; no cloud API. Data under `~/.workgraph/`
- **Resumable pipeline** — interrupt before `final`; re-run skips completed stages
- **Three-model setup** — `commitModel`, `reportModel`, `narrativeModel` (saved in config)
- **Review periods** — `--period` scopes the pipeline to a date window (`RECONSTRUCTION.<project>.2024.md`)
- **Evidence vs interpretation** — deterministic commit data separate from model-generated layers
- **Q&A feedback loop** — questions in `finish/*.question.json`; answers on the finish archive with provenance
- **Portability** — `export` / `import` bundles without LLM calls
- **Role-aware output** — Principal, Staff, Senior, Junior framing
- **Optional `deepen`** — second round (`RECONSTRUCTION.<project>.v2.md`) when you recall more team context, pivots, or review framing

### Pipeline

| Stage | Command | Purpose |
|-------|---------|---------|
| Preflight | `check` | Ollama + models |
| Setup | `authors`, `init` | Your emails, role, project story |
| Evidence | `evidence`, `summarize` | Patches + per-commit signals |
| Sessions | `commit-group`, `report` | Work sessions + cumulative report |
| Narrative | `prepare`, `final` | Questions → your answers → markdown |
| Extend | `deepen` | Second round with recalled context |
| All-in-one | `run` | Through `final` |

Point the CLI at a repo where you actually worked. It extracts evidence from Git, asks up to four role-aware questions per round (what Git cannot infer), stores your answers separately from the prepared narrative, and delivers `RECONSTRUCTION.<project>.md` — impact narrative, role bullets, CV bullets, and interview Q&A grounded in evidence.

This is **not** a commit counter or auto-scored achievement tool. It does **not** claim customer impact or production usage unless **you** stated that in an answer.

### Example outputs

Real reconstructions from dogfooding (MacBook Pro M4 Pro, 48 GB, local Ollama):

- [Forge Secure Notes for Jira](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) — Principal, ~300 commits, security-heavy product
- [keycloak-radius-plugin](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/keycloak-radius-plugin/RECONSTRUCTION.keycloak-radius-plugin.v2.md) — Staff, open-source IAM / RADIUS
- [dev-workgraph (this project)](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/dev-workgraph/RECONSTRUCTION.dev-workgraph.v2.md) — Staff, tooling / DevEx

More: [`examples/README.md`](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/README.md)

### Recommended models

| Slot | Model | Used for |
|------|--------|----------|
| `commitModel` | `qwen2.5-coder:14b` | `summarize`, `commit-group` |
| `reportModel` | `gpt-oss:latest` | `report` |
| `narrativeModel` | `gemma4:31b` | `init`, `prepare`, `final`, `deepen` |

On a ~300-commit repo, unattended stages took **~6 hours** before interactive `final` questions (hardware- and model-dependent).

### Documentation

- [README](https://github.com/vzakharchenko/dev-workgraph#readme)
- [CLI README](https://github.com/vzakharchenko/dev-workgraph/blob/main/dev-workgraph-cli/README.md)
- [ARCHITECTURE.md](https://github.com/vzakharchenko/dev-workgraph/blob/main/ARCHITECTURE.md)
- [REQUIREMENTS.md](https://github.com/vzakharchenko/dev-workgraph/blob/main/REQUIREMENTS.md)

## [1.0.0] - 2026-06-27

### Added

- Apache 2.0 license and `LICENSE` in package output files
- `prepublishOnly` script for pre-publish verification

[1.0.1]: https://github.com/vzakharchenko/dev-workgraph/releases/tag/v.1.0.1
[1.0.0]: https://github.com/vzakharchenko/dev-workgraph/releases/tag/v.1.0.0
