# Changelog

All notable changes to **dev-workgraph** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Evidence — patch splitting for large commits.** After noise filtering, patches larger than 24 000 characters (`MAX_PATCH_CHARS`) are exported as numbered parts on **file boundaries** instead of a single monolithic `.patch`:
  - `commits/<ts>/<hash>.json` — manifest with `split: true`, `partCount`, and full-commit deterministic layer
  - `commits/<ts>/<hash>.partN.json` + `.partN.patch` — scoped deterministic + patch slice per part
  - Oversized single-file hunks may be truncated in their own part (`patchTruncated: true` on the part record only)
- **Evidence — noise filtering before export/split.** Ignore profiles (JavaScript/TypeScript and Java) drop generated/vendored paths from patch hunks; dropped paths are disclosed in `deterministic.excludedFiles`.
- **Summarize — split-commit pipeline (6 steps, automatic).** Large commits are summarized part-by-part, merged deterministically, finalized with three LLM passes, then written as a canonical summary:
  1. Summarize each part → `summaries/<ts>/<hash>.partN.json`
  2. Deterministic merge → `summaries/<ts>/<hash>.merge.json`
  3. LLM polish `signalReasons`
  4. LLM compose `summary`
  5. LLM reframe `questionsAnalysis` (exactly four items)
  6. Write canonical → `summaries/<ts>/<hash>.json`
- **Summarize — empty / noise-only patches.** When a patch has no `diff --git` hunks after filtering, summarize skips the LLM, writes an empty model layer, and records `provenance.model: "(none)"` (console: `skipped (empty patch)`).
- **Summarize — resume.** Existing `.partN.json` / `.merge.json` audit files are reused; only the missing steps run until the canonical summary exists.
- **commit-group — empty summary filter.** Commits with `"(none)"` provenance or a blank summary are excluded before `groupByGap` (console reports how many were skipped).

### Changed

- **Evidence and summaries are separate on disk.** `commits/` holds deterministic evidence only; `summarize` writes model layers under `summaries/<ts>/<hash>.json`. Downstream stages join evidence with **canonical** summaries (legacy inlined `model` on evidence files is still read when no summary file exists).
- **commit-group input.** Loads `commits/` + `summaries/`; does not read `.partN.json`, `.merge.json`, or raw `.patch` files.
- **Model provenance.** `provenance` on summarize/group model layers is `{ model, generatedAt }` only (`patchTruncated` removed from model provenance; truncation remains on evidence part records where applicable).
- **Dependencies** bumped to current releases, including **`undici`** (explicit HTTP client for Ollama), `@biomejs/biome` 2.5.2, `@types/node` ^26.1, and `knip` ^6.23.

### Fixed

- **Ollama HTTP timeout.** Requests no longer abort after ~5 minutes on slow local models; `headersTimeout` and `bodyTimeout` are set to **1 hour** via undici (fixes premature failures during `summarize`, `commit-group`, and other long LLM steps).
- Large “Init”-style commits no longer fail or lose context when a single patch exceeds LLM context limits.
- Noise paths (e.g. `.env`, lockfiles, `node_modules`) no longer inflate patch size or disagree with `changedFiles` after filtering runs **before** chunking.

### Migration

- **Re-summarize a split commit:** delete `summaries/<ts>/<hash>.json` (and optionally `.partN.json` / `.merge.json`), then run `summarize` again.
- **Re-export evidence** (e.g. after ignore rule changes): delete the commit folder under `commits/<ts>/`, then run `evidence` again.
- Append-only behavior is unchanged: existing complete exports and canonical summaries are skipped on re-run.

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
