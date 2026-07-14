# Changelog

All notable changes to **dev-workgraph** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - NEXT RELEASE

### Added

#### Question provenance and question cards

Open threads carry **CLI-attached lineage** through the pipeline (`threadId`, `derivedFromThreadIds`, `sourceGroupIds`, `sourceCommits`) — attached after LLM steps at `commit-group`, `report` fold, `prepare`/`deepen`, and copied to `finish/*.question.json`. **`evidenceExcerpt`** (deterministic) and **`whyAsked`** (deterministic from `missingPiece`; neutral missing-context explanation, not role coaching) are shown in prepare preview and before interactive Q&A in `final` / `deepen`.

Documented in [`REQUIREMENTS.md`](REQUIREMENTS.md) §7; diagrams in [`uml/question-provenance.puml`](uml/question-provenance.puml).

#### Neutral whyAsked (question cards)

**`whyAsked`** is always built in code from `missingPiece` (`buildWhyAsked`) — LLM career framing is no longer used. Role-aware wording stays in **`question`** topic choice only.

#### Neutral question style (prepare / deepen)

**`QUESTION_STYLE_RULES`** in prompts: questions are role-calibrated by **topic**, not performance-review tone. Post-LLM **`normalizeQuestionText`** strips «As a Staff Developer…» and similar openers. **`dryObservationLine`** keeps evidence bullets factual.

#### Scannable evidence bullets (question cards)

**`evidenceExcerpt`** is built per thread from **`observation[]`** (ranked by relevance to the question) + **`sourceCommits`**, then optionally compressed by **`polishEvidenceExcerptsWithLlm`** (prepare step 5 / deepen). No group `hiContext` merge dump.

## [1.0.3] - 2026-07-09

### Added

#### LM Studio support

**LM Studio** is a first-class local backend alongside Ollama. Ollama and LM Studio can run on **different machines**; each pipeline stage can use a different provider and model.

| Surface | Behavior |
|---------|----------|
| **Discovery** | `check` and model pickers probe **both** backends; only servers that respond with at least one model are listed |
| **CLI URLs** | `--ollama-url <url>` (default `http://127.0.0.1:11434`), `--lmstudio-url <url>` (default `http://127.0.0.1:1234`) |
| **`run`** | Three interactive picks — **commit**, **report**, **narrative** — with models from all reachable backends in one list (`model name (Ollama)` / `(LM Studio)`) |
| **Config** | Each slot stores `provider`, `baseUrl`, and `model` under `commit` / `report` / `narrative` in `~/.workgraph/config.json` |
| **LM Studio lifecycle** | On each pipeline step: unload all models → load the chosen model → unload all in `finally` (frees VRAM between steps and after the run) |
| **Safety** | LM Studio is detected via native `GET /api/v1/models` so Ollama on port `11434` is never mistaken for LM Studio |

Environment overrides: `WORKGRAPH_OLLAMA_URL`, `WORKGRAPH_LLM_URL`, `OLLAMA_HOST`, `LM_STUDIO_BASE_URL`, and optional `config.llm.servers.ollama` / `servers.lmstudio`.

#### Pluggable LLM providers

LLM backends are a **plugin layer** (`LlmProviderKind` + `LlmProvider` in `src/lib/llm/`). Built-in providers register in `LLM_PROVIDER_KINDS` (`providers.ts`).

| Step | What to implement |
|------|-------------------|
| 1 | Extend `LlmProviderId` in `types.ts` |
| 2 | Runtime: `LlmProvider` (`getModels`, `chatJson`, …) |
| 3 | Plugin: `LlmProviderKind` (CLI URL flag, discovery, install help) — see `ollamaKind` / `lmstudioKind` |
| 4 | Append to `LLM_PROVIDER_KINDS` |

After registration, `check`, model pickers, and `--<id>-url` flags work without extra CLI wiring. Documented in [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Extending LLM providers*.

#### Pluggable commit-group strategies

**Partition logic** for `commit-group` is a **plugin layer** (`CommitGroupStrategy` in `src/lib/commit-group/`). The shipped **day-gap** strategy (chronological work sessions by day gap) is the default; custom strategies register in `COMMIT_GROUP_STRATEGIES` (`registry.ts`) — the only file that imports concrete implementations.

| Surface | Behavior |
|---------|----------|
| **Customizable** | `gatherRunInputs` + `init` + `partition` — how commits split into buckets (`members[]` + `fileKey`) |
| **Fixed runner** | `buildGroupRecord`, classify/compose LLM steps, `GroupRecord` schema — unchanged for `report` |
| **CLI** | `--strategy <id>`; strategy-owned flags via `cliOptions` + `pickCliOptions` (day-gap: `--days`, `--max-commits`) |
| **`run`** | Prompts for grouping strategy when more than one is registered; saves `commitGroupStrategy`; calls `gatherRunInputs` for strategy-specific settings (reuses saved values without prompting) |

| Step | What to implement |
|------|-------------------|
| 1 | `CommitGroupStrategy` — `id`, `displayName`, `cliOptions`, `pickCliOptions`, `gatherRunInputs`, `init`, `partition`, `formatSummary` |
| 2 | Implement in e.g. `day-gap-strategy.ts` / `jira-strategy.ts` — reuse `grouping.ts` helpers optionally |
| 3 | Append to `COMMIT_GROUP_STRATEGIES` in `registry.ts` |

After registration, `registerCommitGroupStrategyOptions` exposes strategy CLI flags on `commit-group` without editing the action. Documented in [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Extending commit-group strategies* (`img/commit-group-strategies.png`, `img/commit-group-strategies-flow.png`).

#### Examples

New and extended reconstruction samples under [`examples/`](https://github.com/vzakharchenko/dev-workgraph/tree/main/examples) — see [`examples/README.md`](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/README.md).

| Example | Role | Files | Notes |
|---------|------|-------|--------|
| [forge-sql-orm](https://github.com/forge-sql-orm/forge-sql-orm) | Principal | v1–**v5** | **New** — Drizzle + @forge/sql ORM; deepen chain (Atlas Camp, Atlassian blog, core/extra split, Forge SQL security hardening); **20** cumulative Q&A |
| [dev-workgraph](https://github.com/vzakharchenko/dev-workgraph) (this repo) | Staff | v1–**v5** | **Extended** — four `deepen` rounds (product motivation → architecture → OSS publish → adoption/security/plugins); **20** cumulative Q&A; dogfooding reference |
| [remote-ctrl-gsm](https://github.com/vzakharchenko/remote-ctrl-gsm) | Staff | v1 | **New** — Outlander PHEV remote control; Smali APK mod, VPN/Docker/MikroTik, SmartThings; large smali-heavy commits |

#### Role definitions (IC competency matrix)

Canonical role grounding for all ten `init` roles (backend and frontend ladders) in `role-definitions.ts`, mapped from the **Software Developer** IC matrix (Scope & Impact, Execution, Collaboration, Business Impact).

| Surface | Behavior |
|---------|----------|
| **`init`** | Role picker shows `Role — shortSummary`; after selection, the full competency text is printed to the console |
| **LLM prompts** | `projectContextBlock` injects a compact `ROLE DEFINITION` block (matrix level, impact sphere, question/CV emphasis, `doNotClaim` anti-inflation guard) into `summarize`, `prepare`, `final`, `deepen`, `commit-group`, and `report` |
| **Per-repo** | Role is scoped to `project.json` — the same person can use different seniority framing on different repositories |

Role shapes **which gaps to ask about** (`questionsAnalysis`, open questions), not how impressive the narrative sounds.



### Changed

- **commit-group strategies:** `--days` / `--max-commits` are owned by the **day-gap** strategy (not hard-coded on the command); `--strategy <id>` selects the partition plugin. `run` gathers strategy-specific inputs via `gatherRunInputs` at the start (reuses saved repo settings); `init` delegates to the same helper at the `commit-group` step.
- **Role-aware prompts:** inline per-role emphasis maps in `prompts.ts` replaced by `role-definitions.ts`; `cvEmphasisForRole` re-exported from there for CV bullet builders.
- **Ollama `think`:** `commitModel` and `reportModel` calls send `think: false`; `narrativeModel` (`init`, `prepare`, `final`, `deepen`) omits `think` so thinking-capable models use Ollama defaults on narrative stages.

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
- [dev-workgraph (this project)](https://github.com/vzakharchenko/dev-workgraph/blob/main/examples/dev-workgraph/RECONSTRUCTION.dev-workgraph.v5.md) — Staff, tooling / DevEx (v1–v5 deepen chain)

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
