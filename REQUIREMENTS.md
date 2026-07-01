# dev-workgraph Requirements

## Goal

The goal is to check whether dev-workgraph can **reconstruct forgotten engineering work from Git history and surface the right questions** to recover the human context that Git cannot store.

The system should answer the following questions:

0. Can we capture the developer's role and project backstory so later analysis is grounded in human context?
1. Can we export commits and patches in a stable, reproducible format?
2. Can a **deterministic baseline** (no model) already reveal forgotten work and project areas?
3. Can a local model add useful, **non-overclaiming** commit-level descriptions on top of that baseline?
4. Can we group nearby commits into **work sessions** and produce a higher-level summary that respects per-commit signals?
5. Can grouped summaries **remind the user what they worked on and ask the right questions** to reconstruct missing context?
6. Can a **prepared narrative** distill the full report into a role-aligned story with focused questions?
7. Can the human **answer the prepared questions** in `final` and produce a confirmed **role narrative** as `RECONSTRUCTION.<project>.md`?
8. Can **`deepen`** extend that reconstruction after the user remembers more non-code context — four new questions, richer Q&A, and a **versioned** finish archive without overwriting the prior `final`?

dev-workgraph is **not** a public profile generator, portfolio builder, achievement scorer, or interview assistant.
It is an evaluation prototype for one claim: *Git history can be reconstructed into a useful map of forgotten work, where the system reconstructs and asks, and the human confirms.* The final `RECONSTRUCTION.<project>.md` is a **personal reconstruction document** — grounded in Git evidence and human answers — not an auto-scored achievement claim.

### Core stance: reconstruct and ask, do not judge

Git history alone cannot tell us whether work shipped to production, whether it was the user's own design or maintenance of someone else's code, or whether it mattered to a customer. The system must **never claim impact**. Its job is to:

- reconstruct *what* changed and *where*,
- highlight *forgotten* or *high-activity* areas,
- and **ask the user** the questions that recover ownership, intent, and impact.

The questions are the primary product. Summaries and area context are supporting material.

Every LLM step after `init` receives the **project context** (§0): developer role, prepared project story, and the project profile derived from README + story. Questions are framed according to role.

⸻

## 0. Project init (`init`)

Before any export or summarization, the user initializes the repository in dev-workgraph. `init` captures **who the developer is on this project** and **what the project is about**, so every later LLM call has grounding beyond Git patches alone.

`init` is the **first command** in the pipeline and a precondition for `summarize`, `commit-group`, and `report`. `authors` and `evidence` may run without `init`, but model layers produced without project context are incomplete.

### Interactive prompts

1. **Developer role** — which of these best describes the user's role on this project:
   ```
   Principal Developer
   Staff Developer
   Senior Developer
   Junior Developer
   ```
   The choice is persisted per repository in `~/.workgraph/config.json`. A `--role <name>` flag skips the prompt.

2. **Project story** — free-form input (multi-line) covering:
   * what the project is;
   * how it started;
   * key events, pivots, or milestones the user remembers.

   This is raw human context, not evidence. It may be incomplete or wrong; the system treats it as a starting point, not proof.

### Inputs assembled automatically

* **`README.md`** — read from the repository root when present. If missing, `init` continues without it (not an error).
* **Role + project story** — from the prompts above.

### Processing steps

1. **Persist role** — save `role` in the per-repo entry in `~/.workgraph/config.json`.
2. **Prepare story context** — run an LLM session that takes the raw project story and the selected role, and produces a **role-adjusted prepared context**: the same facts reframed for what matters at that seniority (e.g. a Principal Developer story emphasizes system boundaries and cross-cutting decisions; a Junior Developer story emphasizes scope, learning, and what was assigned vs self-directed). The raw story is kept unchanged; the prepared context is an interpretation.
3. **Build project profile** — run a second LLM session with structured JSON output, given:
   * developer role;
   * prepared story context;
   * README contents (if any).
   
   Output: a **project profile** — what the project appears to be about, its domain, apparent technical stack, and key themes/events the README and story support. This is interpretation, not proof.

Both LLM sessions use Ollama. `init` builds human-facing project context (story + profile), so it uses the **`narrativeModel`** slot (see §13).

### On-disk layout

Raw story and prepared context are stored with the project profile under the repo data namespace:

```
~/.workgraph/data/repos/<repo-id>/project.json
```

Example:

```json
{
  "schemaVersion": 1000000,
  "role": "Senior Developer",
  "story": {
    "raw": "Started as a Keycloak RADIUS plugin for a client MFA rollout. Pivoted to open-source when the client changed vendors. Major releases around Keycloak 8→10 upgrades.",
    "preparedContext": "As a Senior Developer on this project, I owned feature areas in the RADIUS plugin and Docker delivery path. Key pivots: client-driven MFA integration, later open-sourcing, and major Keycloak version migrations."
  },
  "readme": {
    "present": true,
    "path": "README.md"
  },
  "profile": {
    "summary": "Open-source Keycloak RADIUS protocol plugin with Docker-based local development, example apps, and CI/release automation.",
    "domains": ["identity", "authentication", "RADIUS", "Keycloak extensions"],
    "apparentStack": ["Java", "Keycloak SPI", "Docker", "Node.js examples"],
    "keyThemes": ["MFA/RADIUS integration", "Keycloak version upgrades", "plugin packaging and delivery"]
  },
  "provenance": {
    "model": "qwen2.5-coder:14b",
    "generatedAt": "2026-06-13T20:00:00.000Z"
  },
  "tokenUsage": {
    "lifetime": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "calls": 0, "byModel": {} },
    "steps": {}
  }
}
```

Config holds only the role (and other CLI prefs); the full project context lives in `project.json`:

```json
{
  "repos": {
    "/absolute/path/to/repo": {
      "role": "Senior Developer",
      "selectedAuthors": ["me@example.com"],
      "groupThresholdDays": 7
    }
  }
}
```

`init` is **idempotent**: if `project.json` already exists, skip. To rebuild the profile, delete `project.json` and re-run.

### Project context in all later LLM calls

Every LLM session in `summarize`, `commit-group`, and `report` must receive a **project context block** prepended to the system or user prompt:

* **role** — from config;
* **preparedContext** — from `project.json` → `story.preparedContext`;
* **project profile** — from `project.json` → `profile` (`summary`, domains, stack, themes).

The model must use this context to:

* interpret patches and summaries in light of what the project is;
* avoid questions that README/story already answer;
* **frame open questions according to role** (via `questionsAnalysis` / `questionsAnalyses`; see §7).

If `project.json` is missing when a model step runs, the CLI warns and continues with an empty project context (same as pre-`init` behavior).

### Role-aware questions

Questions must target what Git cannot know, **adjusted for seniority**. Examples:

| Role | Question emphasis |
|------|-------------------|
| **Principal Developer** | system-wide trade-offs, cross-team boundaries, long-term architectural consequences, production adoption at org scale |
| **Staff Developer** | design ownership across subsystems, platform direction, integration with adjacent systems |
| **Senior Developer** | feature/design ownership, customer or product driver, replacing manual processes, mentoring or review scope |
| **Junior Developer** | assigned vs self-directed work, learning context, scope of autonomy, who reviewed or unblocked |

The system must **never** use role to inflate impact or imply promotion-worthy achievements. Role shapes *which gaps to ask about*, not *how impressive the work sounds*.

⸻

## 0.5 Review periods (`--period`, `init:period`, `run:period`)

A **review period** is a named date window over which the whole pipeline can be run in isolation — for annual or periodic reviews ("what did I do in 2022?"). A period scopes **all** of a repo's data and every stage; it is not a separate kind of analysis, just the same pipeline run against a date-filtered slice of commits, written to its own sub-tree.

### Mechanism — a cross-cutting `--period` flag

Every pipeline command accepts an optional **`--period <id>`** flag (`init`, `evidence`, `summarize`, `commit-group`, `report`, `prepare`, `final`, `deepen`, `run`). Two convenience aliases wrap the common entry points for review workflows:

* **`init:period`** — defines/updates a period and seeds its project context (see below);
* **`run:period`** — runs the whole pipeline for a period end-to-end.

The aliases are thin wrappers: they force "period mode" (prompting for the period label and dates if not passed) and otherwise behave exactly like `init` / `run` with `--period`. Any individual stage can still be run per-period (e.g. re-fold just the report for 2022 with `report --period 2022`).

### Defining a period

Periods are stored per repository in `~/.workgraph/config.json` under a `periods` map, keyed by a human **label** (also used as a directory name — letters, digits, dot, dash, underscore):

```json
{
  "repos": {
    "/absolute/path/to/repo": {
      "role": "Senior Developer",
      "selectedAuthors": ["me@example.com"],
      "groupThresholdDays": 7,
      "periods": {
        "2022": { "from": "2022-01-01", "to": "2023-01-01" },
        "2022-H1": { "from": "2022-01-01", "to": "2022-07-01" }
      }
    }
  }
}
```

* **Dates are ISO `YYYY-MM-DD`.** The range is **half-open `[from, to)`** (from inclusive, to exclusive), so adjacent periods (e.g. `2021` and `2022`) never double-count a commit on the boundary.
* A period is defined by `init:period` / `run:period` / `init`/`run --period` (which accept `--from <iso>` / `--to <iso>`, or prompt for them). Once stored, downstream stages only need `--period <id>` — they read the window from config. Passing `--period <id>` to a downstream stage when the period is **not defined** is an error that tells the user to define it first.

### On-disk layout — nested under `periods/<id>/`

A period's whole data sub-tree is nested under `periods/<id>/` inside the repo namespace, mirroring the repo-level layout exactly:

```
~/.workgraph/data/repos/<repo-id>/periods/<period>/project.json
~/.workgraph/data/repos/<repo-id>/periods/<period>/commits/...
~/.workgraph/data/repos/<repo-id>/periods/<period>/groups/...
~/.workgraph/data/repos/<repo-id>/periods/<period>/reports/...
~/.workgraph/data/repos/<repo-id>/periods/<period>/prepared/...
~/.workgraph/data/repos/<repo-id>/periods/<period>/finish/...
```

The `periods/` wrapper (rather than `<repo-id>/<period>/` directly) guarantees a period label can never collide with a sibling subdir name like `commits`. Period data never mixes with the repo's all-time data, and since it lives **inside** `~/.workgraph/data/repos/<repo-id>/`, it travels automatically with `export`/`import` (§13).

### Project context for a period

By default a period **inherits** the repo-level project context: `init:period` copies `<repo-id>/project.json` into `<repo-id>/periods/<period>/project.json` (no LLM call — role/story rarely change between periods). If no repo-level `project.json` exists to inherit, `init:period` errors and asks the user to run the repo-level `init` first. Downstream stages load the period's `project.json`, falling back to the repo-level one if absent — so a period pipeline always has grounding.

### Commit filtering

`evidence --period <id>` restricts extraction to commits whose **author timestamp** falls in `[from, to)`; everything downstream operates only on those commits. `final`'s deliverable is written to a suffixed file `RECONSTRUCTION.<project>.<period>.md` so a period review never overwrites the repo's all-time `RECONSTRUCTION.<project>.md`. **`deepen`** writes versioned siblings under the same period suffix (`RECONSTRUCTION.<project>.<period>.v2.md`, …; finish archive under `periods/<id>/finish/`).

⸻

## 1. Author selection (precondition for `evidence`)

Git history mixes the user's commits with teammates and bots (Renovate, Dependabot, Snyk). Before evidence extraction, the user must declare which author **emails** are their own work, so only those commits are treated as evidence.

The system scans the repository (`git log --all --no-merges`), aggregates authors **by email** with commit counts, and lets the user select their identities. The selection is persisted per repository in `~/.workgraph/config.json`.

> Lesson from the first real run: near-identical emails (`vzaharchenko@…` vs `vzakharchenko@…`) are easy to confuse in a long list, and selecting the wrong one silently undercounts work. The author picker should surface large identities clearly and may group likely-same-person variants.

⸻

## 1.5 JSON schema versioning (`schemaVersion`)

Every **pipeline JSON artifact** the CLI writes carries a numeric **`schemaVersion`** field so a future CLI can tell which on-disk shape it is reading and migrate or reject safely. This is separate from:

* **`FinishRecord.version`** — the **finish-chain cursor** (`1` = initial `final`, `2+` = each `deepen` round **or** an incremental `final` after new commits; see §11 / §10.5).
* **`~/.workgraph/config.json`** — user/CLI preferences; **not** schema-stamped.

### Encoding

`schemaVersion` is the CLI's **`package.json` semver encoded as one integer**:

```
schemaVersion = major × 1_000_000 + minor × 1_000 + patch
```

Examples: `1.0.0` → `1000000`, `1.2.3` → `1002003`.

At **`npm run build`** (and before `test` / `typecheck` / `dev`), `scripts/generate-version.ts` reads `package.json` and writes `src/lib/version.ts`:

```ts
export const VERSION = 1000000;
```

Every write path uses `writeRecordJson()` → `stampSchemaVersion()`, which sets `schemaVersion: VERSION` on the object immediately before `JSON.stringify`.

### Stamped files

| Artifact | Path |
|----------|------|
| Commit evidence (manifest) | `commits/<ts>/<hash>.json` |
| Commit patch (small commit) | `commits/<ts>/<hash>.patch` |
| Split evidence part | `commits/<ts>/<hash>.partN.{json,patch}` |
| Commit summary (canonical) | `summaries/<ts>/<hash>.json` |
| Split summary part | `summaries/<ts>/<hash>.partN.json` |
| Split merged summary (audit) | `summaries/<ts>/<hash>.merge.json` |
| Work-session group | `groups/<timestampEnd>.json` |
| Cumulative report | `reports/<reportId>.json` |
| Project context | `project.json` |
| Prepared narrative | `prepared/<reportId>.json` |
| Finish archive | `finish/<preparedId>.json` (and `.vN.json`) — cumulative `answers[]`, `sourceQuestions` map |
| Finish questions | `finish/<preparedId>.question.json` (v1) and `.question.vN.json` (v2+) — question text + ids; **not** stored in `prepared/` |
| Export bundle manifest | `manifest.json` inside the `.tar.gz` |

Re-writing an existing file (e.g. re-running `final` on the same finish version) **refreshes** `schemaVersion` to the current CLI build.

### Backward compatibility

* **Readers** treat a missing `schemaVersion` as a **legacy** file written before this field existed; the current CLI continues to load it.
* **Writers** always stamp the current encoded semver on new output.
* A future CLI may refuse to read records with `schemaVersion` below a minimum, or run explicit migrations; the field exists for that path.

⸻

## 2. Commit and patch evidence (`evidence`)

The system must be able to extract commit evidence from a Git repository. Only commits authored by the selected identities (§1) are extracted.

Export can be manual or semi-automated.

Exported data is **namespaced per repository** so commits from different repos never mix. Each commit is stored in a folder named by its author Unix timestamp.

**Small commit:**
```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].patch
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
```

**Split commit** (no monolithic `.patch`; see §2):
```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].partN.{json,patch}
```
`<repo-id>` is a stable `<basename>-<hash8>` derived from the repository's absolute path. Example:
```
~/.workgraph/data/repos/keycloak-radius-plugin-920018a3/commits/1717428123/b0648088.patch
~/.workgraph/data/repos/keycloak-radius-plugin-920018a3/commits/1717428123/b0648088.json
```

The patch must be generated from Git using a reproducible command:
```
git show --format=fuller --find-renames <commit-hash>
```

**Noise filtering** runs on the raw patch **before** it is written or split. Paths matching registered **ignore profiles** (JavaScript/TypeScript and Java modules under `src/lib/ignore/`) are dropped from the patch hunks and listed in `deterministic.excludedFiles`. Directory and file patterns use simple `*` globs (e.g. `node_modules`, `dist`, `package-lock.json`, `*.min.js`). The patch on disk therefore contains only non-noise hunks (or only the Git commit header when every hunk was noise).

Export is **append-only**: existing commits are skipped, never overwritten.
The export should preserve:

* commit hash
* commit date (author date and commit date)
* author
* commit title/message
* changed files (with status: added/deleted/modified/renamed) — **non-noise files only** in `changedFiles`; noise paths only in `excludedFiles`
* patch content (noise-filtered)
* lines added / lines deleted per file (non-noise churn)

#### Small vs split commits

When the filtered patch fits in **≤ 24 000 characters** (`MAX_PATCH_CHARS`), export writes one pair:

```
commits/<ts>/<hash>.json
commits/<ts>/<hash>.patch
```

When the filtered patch is larger, export writes a **split manifest** plus numbered parts (no monolithic `<hash>.patch`):

```
commits/<ts>/<hash>.json          # manifest: split, partCount, full-commit deterministic
commits/<ts>/<hash>.part1.json    # scoped deterministic for files in part 1
commits/<ts>/<hash>.part1.patch
commits/<ts>/<hash>.part2.json
commits/<ts>/<hash>.part2.patch
…
```

Parts are packed on **file boundaries**; a single oversized file may be truncated in its own part (`patchTruncated: true` on that part record). Each part's `deterministic` layer lists only the files whose hunks appear in that part's patch.

#### Noise disclosure (representative patterns)

The following paths are representative of what ignore profiles drop (the live list is in the ignore modules, not hard-coded in `evidence`):

```
node_modules/**
dist/**
build/**
target/**
coverage/**
.next/**
*.min.js
*.map
package-lock.json
yarn.lock
pnpm-lock.yaml
```

The **set of excluded files must be recorded** in `excludedFiles` so the report can disclose what was dropped.

#### Evidence manifest schema (`commits/…`)

**Small commit** — fields below only.

**Split commit** — same manifest fields plus `"split": true` and `"partCount": N`.

Part records (`<hash>.partN.json`) repeat commit metadata, `part`, `partCount`, `patchTruncated`, and a **scoped** `deterministic` layer.

```json
{
  "schemaVersion": 1000000,
  "commitHash": "...",
  "timestamp": 0,
  "title": "...",
  "author": "...",

  "deterministic": {
    "changedFiles": {
      "added": [],
      "deleted": [],
      "modified": [],
      "renamed": []
    },
    "linesAdded": 0,
    "linesDeleted": 0,
    "importantFolders": [],
    "areas": [],
    "excludedFiles": []
  }
}
```

When a commit touches only noise (e.g. a lockfile bump), `changedFiles` and churn may be empty while `excludedFiles` lists the dropped paths and the patch file contains no `diff --git` hunks (header only or empty). Such commits are still exported as evidence.

⸻

## 3. Commit JSON summary (`summarize`)

For every exported patch, `evidence` writes a **pure evidence** JSON next to the patch:
```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
```

`summarize` writes the **model layer** to a sibling file (same timestamp/hash layout):

```
~/.workgraph/data/repos/<repo-id>/summaries/[unix-timestamp]/[hash].json   # canonical
```

For **split commits**, intermediate artifacts are also written (audit / resume; not used by `commit-group` directly):

```
summaries/<ts>/<hash>.partN.json    # per-part model layer
summaries/<ts>/<hash>.merge.json    # deterministic merge of part layers
```

The two layers are kept in **separate files**:

- **Deterministic layer** — in `commits/…`. Computed without any model, always present. This is evidence. Written by `evidence`.
- **Model layer** — in `summaries/…`. Added by `summarize`, optional, clearly marked as interpretation. **Canonical** path is always `summaries/<ts>/<hash>.json`.

`commit-group` loads evidence from `commits/` and joins each commit with its **canonical** summary from `summaries/<ts>/<hash>.json` (legacy evidence files that still inline `model` are supported when no summary file exists). **Split commit manifests** are included only after the canonical summary exists. Each summary file records `sourceEvidence` (the evidence timestamp directory); each group file records parallel `sourceEvidence` / `sourceSummaries` arrays aligned with `groups.commits`.

The model layer is produced by a **local model via Ollama** (HTTP API, default `http://127.0.0.1:11434`). The model is chosen interactively from the installed models and the choice is remembered. Generation uses Ollama structured output (a JSON Schema is passed via the `format` parameter). On response, the CLI **extracts** the JSON object from the raw text (handles markdown fences and surrounding prose), **parses** it, and **schema-validates** the result before accepting — via the shared `chatJson` helper (§13 Resilience). Each generated layer records its provenance (`model` name, timestamp). The **project context block** (§0) is included in every summarize prompt. Summarize is append-only: commits that already have a **canonical** summary file are skipped on re-run.

### Normal commit (one LLM call)

For a small commit with substantive patch content, `summarize` runs **one** LLM session and writes `summaries/<ts>/<hash>.json`.

### Empty / noise-only patch (no LLM)

When the exported patch has **no `diff --git` hunks** (empty, whitespace-only, or Git header only after noise filtering), `summarize` **does not call the model**. It writes a canonical summary with an empty model layer:

* `summary`: `""`
* all signals `low`, empty `changeTypes` / `technologies` / `signalReasons` / `questionsAnalysis`
* `provenance.model`: `"(none)"` (sentinel meaning no LLM was used)

Console: `skipped (empty patch)`.

### Split commit (parts → merge → finalize → canonical)

Large commits use a **six-step** pipeline inside `summarize`:

| Step | Action | LLM | Output |
|------|--------|-----|--------|
| 1/6 | Summarize each part | yes × N | `summaries/<ts>/<hash>.partN.json` |
| 2/6 | Merge part layers | no | `summaries/<ts>/<hash>.merge.json` |
| 3/6 | Polish `signalReasons` | yes | (in memory) |
| 4/6 | Compose `summary` from polished reasons | yes | (in memory) |
| 5/6 | Reframe `questionsAnalysis` (exactly 4) | yes | (in memory) |
| 6/6 | Write canonical summary | no | `summaries/<ts>/<hash>.json` |

**Step 2 (deterministic merge)** unions `changeTypes` and `technologies`, takes max signals, folds `signalReasons` left-to-right across parts, and concatenates `questionsAnalysis`.

**Steps 3–5 (finalize)** read the merged layer plus commit metadata. Signals and `changeTypes` / `technologies` / `confidence` from the merge are kept; only `signalReasons`, `summary`, and `questionsAnalysis` are rewritten by the model. Part and merge files are retained for inspection; downstream stages read only the canonical file.

**Resume:** if `.partN.json` or `.merge.json` already exist, those steps are skipped; finalize runs when the canonical file is still missing. If **all** part patches are empty, steps 1–5 are skipped and step 6 writes the empty `"(none)"` layer.

Per-part empty patches skip the LLM for that part only (same empty layer shape).

### Evidence JSON schema (`commits/…`)

See §2 — evidence files do **not** contain a `model` layer in the current layout.

### Summary JSON schema (`summaries/…`)

```json
{
  "schemaVersion": 1000000,
  "commitHash": "...",
  "timestamp": 0,
  "sourceEvidence": "1781251338",

  "model": {
    "summary": "...",
    "changeTypes": [],
    "technologies": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": {
      "technical": "...",
      "architecture": "...",
      "security": "..."
    },
    "questionsAnalysis": [
      {
        "observation": "...",
        "missingPiece": "...",
        "question": "..."
      }
    ],
    "confidence": "low | medium | high",
    "provenance": {
      "model": "llama3.2 | (none)",
      "generatedAt": "..."
    }
  }
}
```

#### Field meaning

**`schemaVersion`** — encoded CLI semver when the file was last written (§1.5). Absent on legacy files.

**Deterministic layer (no model, always trustworthy):**

`changedFiles` — all files touched by the commit, by status.

`linesAdded` / `linesDeleted` — churn, computed from the patch.

`importantFolders` — folders touched by this commit (raw, derived from file paths).

`areas` — project areas this commit touches (see §5 for how areas are defined).

`excludedFiles` — files dropped by noise filtering, so nothing is silently hidden.

**Model layer (interpretation, may be wrong):**

`summary` — plain-language explanation of what changed. Must describe the *change*, not its importance or impact. Empty when the patch had no substantive diff (`provenance.model` is `"(none)"`). **Routine upkeep is named, not detailed:** if the commit is only a dependency/version bump, lockfile, formatting, or CI change, say so plainly without naming versions; if it also has substantive work, describe **only** the substantive part. (Shared `ROUTINE_RULE`, applied at every stage.)

`technologies` — languages, frameworks, libraries, tools, and protocols the patch actually uses (canonical names; empty when skipped).

`changeTypes` — zero or more of:
```
feature
bugfix
refactoring
security
infrastructure
testing
configuration
developer-tooling
architecture
documentation
deployment
```

`technicalSignal` / `architectureSignal` / `securitySignal` — coarse `low | medium | high` estimates of, respectively, technical depth; whether the change affects structure/boundaries/modules/system design; and whether it relates to authentication, authorization, identity, data protection, permissions, or platform security.

> **No numeric scores.** Signals are `low/medium/high` only, and each non-`low` signal **must** come with a one-line `signalReasons` justification grounded in the patch. A signal without a reason is treated as `low`. This prevents false precision (e.g. "0.72") and forces the model to point at evidence.

`questionsAnalysis` — the **reasoned form** of the missing context and the **primary commit-level question output**: an array of `{ observation, missingPiece, question }` entries. `observation` states what the *diff* actually shows (grounded in the patch, not the message); `missingPiece` names the human context the patch cannot establish (ownership, intent, whether it shipped); `question` is the single question to ask the developer to recover it. This is where the model puts anything it cannot know from the patch. A purely routine commit may have an empty array. There is **no** separate flat `questions` field — question strings live inside this structure (and are derived in code when needed for interactive Q&A).

`confidence` — the model's confidence in its own summary, `low | medium | high`.

`provenance` — attached by the CLI (not model output): `model` (Ollama model name, or `"(none)"` when summarize skipped the LLM), `generatedAt`.

#### Example (canonical summary; evidence lives in `commits/…`)

```json
{
  "schemaVersion": 1000000,
  "commitHash": "b0648088",
  "timestamp": 1717428123,
  "sourceEvidence": "1717428123",

  "model": {
    "summary": "Added Maven build profiles, ZIP assembly, backend package metadata, build/deploy scripts, static asset packaging, and an HTTP upgrade endpoint.",
    "changeTypes": ["infrastructure", "deployment", "developer-tooling"],
    "technologies": ["Java", "Maven", "Node.js"],
    "technicalSignal": "medium",
    "architectureSignal": "medium",
    "securitySignal": "low",
    "signalReasons": {
      "technical": "Introduces build tooling across Maven and Node, multiple moving parts.",
      "architecture": "Defines a deployment boundary and packaging assembly, affects how the system ships.",
      "security": "No auth/identity/data-protection code touched."
    },
    "questionsAnalysis": [
      {
        "observation": "The diff adds Docker deploy/build scripts and changes .gitignore and package metadata, which looks like local-environment setup rather than a production deploy.",
        "missingPiece": "Unclear whether this container ever reached real servers or stayed developer tooling.",
        "question": "Was this Docker flow deployed to staging/production, or only used to run the service locally?"
      }
    ],
    "confidence": "medium",
    "provenance": {
      "model": "llama3.2",
      "generatedAt": "2026-01-15T12:00:00.000Z"
    }
  }
}
```

#### Example (empty / noise-only summary)

```json
{
  "schemaVersion": 1000000,
  "commitHash": "907a6e4e1fd132b58a830bb161a00c590ffc5269",
  "timestamp": 1748611936,
  "sourceEvidence": "1748611936",

  "model": {
    "summary": "",
    "changeTypes": [],
    "technologies": [],
    "technicalSignal": "low",
    "architectureSignal": "low",
    "securitySignal": "low",
    "signalReasons": { "technical": "", "architecture": "", "security": "" },
    "questionsAnalysis": [],
    "confidence": "low",
    "provenance": {
      "model": "(none)",
      "generatedAt": "2026-07-01T11:48:27.900Z"
    }
  }
}
```

#### Legacy combined example (evidence + inline model)

Older exports may still inline `model` on the evidence file. Current pipeline keeps evidence and summary separate. Representative combined shape:

```json
{
  "schemaVersion": 1000000,
  "commitHash": "b0648088",
  "timestamp": 1717428123,
  "title": "Production build and deployment automation",
  "author": "v.zakharchenko@tempo.io",
  "deterministic": {
    "changedFiles": {
      "added": [
        "assembly/production.xml",
        "backend/build.sh",
        "backend/deploy.sh",
        "backend/package.json",
        "backend/pom.xml"
      ],
      "deleted": [],
      "modified": [".gitignore", "backend/server.js"],
      "renamed": []
    },
    "linesAdded": 214,
    "linesDeleted": 18,
    "importantFolders": ["assembly", "backend"],
    "areas": ["backend", "build-and-deploy"],
    "excludedFiles": ["backend/package-lock.json"]
  },
  "model": {
    "summary": "Added Maven build profiles, ZIP assembly, backend package metadata, build/deploy scripts, static asset packaging, and an HTTP upgrade endpoint.",
    "changeTypes": ["infrastructure", "deployment", "developer-tooling"],
    "technicalSignal": "medium",
    "architectureSignal": "medium",
    "securitySignal": "low",
    "signalReasons": {
      "technical": "Introduces build tooling across Maven and Node, multiple moving parts.",
      "architecture": "Defines a deployment boundary and packaging assembly, affects how the system ships.",
      "security": "No auth/identity/data-protection code touched."
    },
    "questionsAnalysis": [
      {
        "observation": "The diff adds Docker deploy/build scripts and changes .gitignore and package metadata, which looks like local-environment setup rather than a production deploy.",
        "missingPiece": "Unclear whether this container ever reached real servers or stayed developer tooling.",
        "question": "Was this Docker flow deployed to staging/production, or only used to run the service locally?"
      }
    ],
    "confidence": "medium"
  }
}
```

⸻

## 4. Commit grouping (`commit-group`)

After export and per-commit summarize, the system groups commits into **work sessions** — bursts of activity separated by quiet periods. Each group gets its own JSON file with a **rebuilt deterministic layer** (aggregated from member commits) and a **new model layer** produced by **two local LLM sessions** (classify, then compose) that read the member commit JSONs and their signals.

**Empty commit summaries are excluded from grouping.** Commits whose canonical summary was written without an LLM (`provenance.model` is `"(none)"`, or `summary` is blank) are filtered out before `groupByGap`. They do not count toward session gaps, tier partitions, or group LLM input. Unsummarized commits (`model: null`) are still loaded and grouped (tier `low`) until summarize runs. Console reports how many empty summaries were skipped, e.g. `12 commit(s) → 10 for grouping (2 empty summaries skipped) → …`. If every exported commit is empty-skipped, `commit-group` exits without creating groups.

### Grouping thresholds

Before grouping, the CLI asks two values, both persisted per repository in `~/.workgraph/config.json`:

* **`groupThresholdDays`** — max days that may pass between consecutive commits before starting a new group.
* **`groupMaxCommits`** — max commits per group (`0` = unlimited), so very long bursts are split into bounded sessions.

```json
{
  "repos": {
    "/absolute/path/to/repo": {
      "role": "Senior Developer",
      "selectedAuthors": ["me@example.com"],
      "groupThresholdDays": 7,
      "groupMaxCommits": 20
    }
  }
}
```

On later runs the saved values are offered as defaults; the user may change them. `--days <n>` and `--max-commits <n>` skip the prompts.

### Grouping algorithm (deterministic)

1. Load all exported commit JSONs for the repository, join each with its **canonical** summary from `summaries/<ts>/<hash>.json` when present, **oldest first**. Skip split manifests until canonical summary exists.
2. **Drop commits with empty summaries** (§3 empty / `"(none)"` layer).
3. Walk chronologically. Commits whose author timestamps are within `groupThresholdDays` of the **previous commit in the current group** belong to the same group.
4. Close the current group and start a new one when **either** the gap exceeds the threshold **or** the current group has reached `groupMaxCommits` commits (when that cap is > 0).
5. A group with a single commit is valid.

Each group is written to:

```
~/.workgraph/data/repos/<repo-id>/groups/[unix-timestamp].json
```

`[unix-timestamp]` is the **author Unix timestamp of the last commit** in the group (seconds). Example:

```
~/.workgraph/data/repos/keycloak-radius-plugin-920018a3/groups/1717428123.json
```

Grouping is **append-only**: existing group files that already have a **`model` layer** are skipped on re-run.

#### Incremental re-run: extension groups (no duplicate supersets)

On a re-run, `commit-group` still recomputes work sessions from **all** exported commits (`groupByGap`), but before summarizing each session it **subtracts commit hashes already present** in on-disk group files that have a completed `model` layer (`coveredCommitHashes` / `extensionSessions` in code).

| Situation | Behaviour |
|-----------|-----------|
| Session fully covered by existing groups | **Skipped** (no new file, no LLM) |
| **New commits extend the last session** (same gap bucket; `timestampEnd` would change) | Writes an **extension group** containing **only the uncovered commits** — not a duplicate superset of the old group |
| Wholly new session after a gap | Normal new group file |

This keeps `groups/` consistent with incremental `report` resume: the report folds one new group per extension instead of folding an enlarged session on top of the old one (which would duplicate history). Old group files are **not deleted** automatically; orphaned supersets from runs before this rule may remain on disk until cleaned manually.

Console summary distinguishes **fully covered** sessions from **to summarize** extension/new groups.

### Group JSON schema

A group record mirrors the commit record shape (deterministic + model layers) but adds a `groups` block: all member commit hashes plus their **deterministic tier partition**.

```json
{
  "schemaVersion": 1000000,
  "groupId": 1717428123,
  "timestampStart": 1717000000,
  "timestampEnd": 1717428123,
  "commitCount": 3,

  "groups": {
    "commits": [],
    "tiers": {
      "low": [],
      "medium": [],
      "hi": []
    },
    "sourceEvidence": [],
    "sourceSummaries": []
  },

  "deterministic": {
    "changedFiles": {
      "added": [],
      "deleted": [],
      "modified": [],
      "renamed": []
    },
    "linesAdded": 0,
    "linesDeleted": 0,
    "importantFolders": [],
    "areas": [],
    "excludedFiles": []
  },

  "model": null
}
```

#### `groups` block

`commits` — ordered list of full commit hashes in the group. **Deterministic**.

`sourceEvidence` — author Unix timestamp (the `commits/<timestamp>/` directory name), **same order as `commits`**. Together with `commits[i]` this locates `commits/<sourceEvidence[i]>/<commits[i]>.json`.

`sourceSummaries` — repo-relative paths to each member's summary file (`summaries/<ts>/<hash>.json`), **same order as `commits`**; `null` when that commit has no summary file (e.g. not yet summarized).

`tiers` — a **deterministic** partition of the member hashes by signal tier. Every hash in `commits` appears in exactly one of `low` / `medium` / `hi`. This keeps the "which commit is high/medium/low" link as evidence, separate from the model's narrative context. Computed (not guessed) by these rules:

| Tier | Rule |
|------|------|
| `low` | All three per-commit signals (`technicalSignal`, `architectureSignal`, `securitySignal`) are `low`, **or** the commit has `model: null` (not yet summarized) |
| `hi` | At least one per-commit signal is `high` |
| `medium` | At least one signal is `medium` and none is `high` |

Commits with **empty summaries** (`"(none)"`) never appear in `groups.commits` — they are filtered before grouping (see above).

Commits in the `low` tier are **weak context** — the group narrative de-emphasizes them (just a brief mention). The tiers are passed to the LLM as reference; the model does not re-partition the hashes.

#### Deterministic layer (aggregated, no model)

Rebuilt from the member commits' deterministic layers using the same rules as export:

* `changedFiles` — union of all file paths per status bucket across member commits (deduplicated, sorted).
* `linesAdded` / `linesDeleted` — sum of per-commit churn.
* `importantFolders` — union of per-commit folders.
* `areas` — union of per-commit areas (see §5).
* `excludedFiles` — union of per-commit excluded files.

This layer is evidence. It is written at group-creation time, before the LLM call.

#### Model layer (group interpretation) — two LLM sessions

The group model layer is built in **two separate LLM sessions** per group via Ollama (same stack as `summarize`: `chatJson` with structured JSON output, extract/parse/schema validation — §13, provenance, signal-without-reason enforcement). Both sessions include the **project context block** (§0). Splitting the work keeps each call focused and lets the `history` be a faithful *merge* of the per-commit summaries rather than a fresh invention.

**Session 1 — classify** (`groupClassifyJsonSchema`, no `summary`):

* Input: the aggregated deterministic layer, a compact tier-annotated view of every member commit (title, areas, churn, signals, per-commit summary, **and the commit's `questionsAnalysis`**), and the deterministic `groups.tiers` partition as reference.
* Output: session-level `technicalSignal` / `architectureSignal` / `securitySignal` (each non-low with a reason), `changeTypes`, `confidence`, three arrays of **context bullets** — `hiContext`, `mediumContext`, `lowContext` — and **`questionsAnalyses`** (see below). These bullets are short phrases, **not** commit hashes. Commits close in meaning are **merged** into one bullet; unrelated ones are **added** as separate bullets.

`questionsAnalyses` — the **aggregated** reasoned-question form for the whole session. Where a *commit* carries `questionsAnalysis` with scalar `observation` / `missingPiece` / `question`, a *group* merges its members' analyses into entries whose three fields are **arrays**: `{ observation: [], missingPiece: [], question: [] }`. The model groups member-commit analyses that probe the **same open thread** into one entry (unioning their observations and missing pieces; keeping one sharp question per thread when possible) and keeps unrelated threads as separate entries. Routine upkeep does not produce an entry. There is **no** separate flat `questions` field at group level.

**Session 2 — compose** (`groupComposeJsonSchema`, only `{ summary }`):

* Input: the session signals and context tiers from session 1, plus the member commits' per-commit summaries grouped by tier.
* Output: `history` — a first-person, multi-paragraph **merge** of the commit summaries (a fuller account, not a terse summary) whose detail follows the tiers: **HIGH is mandatory** — cover every item in full (a paragraph or more per strand, naming real subsystems/areas); **MEDIUM must be mentioned** — covered briefly, not dropped, but need not be exhaustive item-by-item; **LOW is optional** — at most a brief mention, may be omitted.

Both sessions follow the same rules: first-person voice (never "the team"/"they"/"we"), no overclaiming (never infer production usage, ownership, or impact — put unknowns into `questionsAnalyses`), open questions framed according to role (§0), and the shared **routine rule** — routine upkeep (dependency/version bumps, build/CI/formatting) is kept to a single generic `lowContext` bullet (never in hi/medium); if the whole session is only routine the `history` is one short sentence stating that; if there is substantive work, only the substantive work is described.

The final `model` object = session-1 fields (`changeTypes`, the three signals + `signalReasons`, `questionsAnalyses`, `confidence`, `hiContext`, `mediumContext`, `lowContext`) + session-2 `history` + a `provenance` block the CLI attaches after generation.

Group summarize is append-only: groups that already have a `model` layer are skipped on re-run.

#### Example

```json
{
  "schemaVersion": 1000000,
  "groupId": 1717428123,
  "timestampStart": 1717350000,
  "timestampEnd": 1717428123,
  "commitCount": 3,

  "groups": {
    "commits": [
      "a1b2c3d4e5f6...",
      "f6e5d4c3b2a1...",
      "1234567890ab..."
    ],
    "tiers": {
      "low": ["1234567890ab..."],
      "medium": ["a1b2c3d4e5f6..."],
      "hi": ["f6e5d4c3b2a1..."]
    }
  },

  "deterministic": {
    "changedFiles": {
      "added": ["backend/deploy.sh"],
      "deleted": [],
      "modified": [".gitignore", "backend/server.js", "docker/scripts/docker-radius.sh"],
      "renamed": []
    },
    "linesAdded": 220,
    "linesDeleted": 20,
    "importantFolders": ["assembly", "backend", "docker/scripts"],
    "areas": ["backend", "docker"],
    "excludedFiles": ["backend/package-lock.json"]
  },

  "model": {
    "history": "I built out deployment automation for the backend during this session. I added a deploy script and packaging so the service ships as a self-contained artifact, and adjusted the server entrypoint to match the new layout. Alongside that, I made a small fix to the docker-radius startup script.",
    "changeTypes": ["infrastructure", "deployment", "bugfix"],
    "technicalSignal": "medium",
    "architectureSignal": "medium",
    "securitySignal": "low",
    "signalReasons": {
      "technical": "Spans build/deploy scripting and backend packaging across multiple files.",
      "architecture": "Touches deployment boundary and how the backend ships.",
      "security": "No auth/identity/data-protection code in the substantive commits."
    },
    "hiContext": ["Added backend deploy scripting and packaging, and adjusted the server entrypoint"],
    "mediumContext": ["Reworked how the backend artifact is assembled"],
    "lowContext": ["Minor docker-radius startup script fix"],
    "questionsAnalyses": [
      {
        "observation": [
          "Added deploy scripting and packaging so the backend ships as a self-contained artifact.",
          "Adjusted the server entrypoint to match the new layout."
        ],
        "missingPiece": ["Unclear whether this deployment path was used in production or only experimentally."],
        "question": ["Was the deployment work used in production or experimental?"]
      },
      {
        "observation": ["Made a small fix to the docker-radius startup script."],
        "missingPiece": ["Unclear whether the fix addressed a reported issue or was incidental cleanup."],
        "question": ["Was the docker-radius fix related to a reported issue, or incidental cleanup during the same session?"]
      }
    ],
    "confidence": "medium",
    "provenance": {
      "model": "qwen2.5-coder:14b",
      "generatedAt": "2026-06-13T15:00:00.000Z"
    }
  }
}
```

⸻

## 5. Project area detection and context

Areas are a separate context layer from individual commits. The purpose of area context is **not** to prove what a commit did. It is to explain *what part of the project was affected*, *what subsystem the files belong to*, and *what questions should be asked to confirm the area's rationale*.

### How an area is defined

Area detection must be **deterministic and explainable** — no model required:

1. **Rule:** an area is the **top-level project folder** of a changed file — the first path segment (e.g. `backend/server.js` → `backend`, `docs/x.png` → `docs`). Files at the repository root map to the `(root)` area.
2. This is intentionally simple and universal — no hardcoded container lists or per-project configuration.
3. Each file belongs to exactly one area; a commit's `areas` is the set of areas its non-noise files touch.

### Area context at group level

Area rollups are computed **deterministically from group JSON** when producing the report (§8): union of `deterministic.areas` across groups, commit counts and churn summed per area.

The model layer may then *describe* an area (what it seems to be for, what role it plays), but the **membership of files in areas is computed, not guessed**.

⸻

## 6. Commit-group session flow

Processing runs in chronological order, oldest group first.

For every group:

1. **Determine membership** — apply the day-threshold + max-commits algorithm (§4) to exported commit JSONs.
2. **Write `groups.commits`** — ordered list of member commit hashes.
3. **Aggregate the deterministic layer** — merge `changedFiles`, churn, folders, areas, and `excludedFiles` from member commits (§4).
4. **Partition signal tiers** — compute the deterministic `groups.tiers` (`low` / `medium` / `hi`) from per-commit model signals.
5. **Session 1 — classify** — send the group deterministic layer, the tier-annotated member commits, and the `groups.tiers` reference to Ollama; get session signals + the three context-bullet arrays.
6. **Session 2 — compose** — send the classification + the per-commit summaries grouped by tier; get the merged first-person `history`.
7. **Write the model layer** — assemble session-1 fields + session-2 `history` + `provenance`.
8. **Persist** the group JSON to `~/.workgraph/data/repos/<repo-id>/groups/[timestampEnd].json`.

The deterministic layer, `groups.commits`, and `groups.tiers` must always be produced. The model layer is best-effort: if the local model is unavailable or fails on either session, the group is still saved with `model: null`, and the report counts it as "not summarized."

Per-commit data is never modified by `commit-group`; only group files are written.

⸻

## 7. Questions and missing context — the primary output

Git history cannot explain business context, ownership, or impact. The system's main value is generating the **questions a human must answer** to recover that context.

Questions are **role-aware** (§0): the same patch may prompt a Principal Developer about org-wide rollout consequences and a Junior Developer about whether the task was assigned or self-initiated. Project profile and prepared story context prevent asking about facts the user already provided at `init`.

Each question is backed by a **reasoned analysis** so it is traceable, not a bare prompt. At commit level this is `questionsAnalysis` — `{ observation, missingPiece, question }`: the diff evidence that triggered the question, the human context it cannot establish, and the question itself (§3). At group and report level the same structure is **aggregated** into `questionsAnalyses` (array-valued fields), so open threads are merged and re-folded as work accumulates (§4, §8). At **`prepare`** the report's `questionsAnalyses` are reframed into up to four role-aware entries; **`final`** and **`deepen`** present the `question` strings to the human (derived in code via `flattenQuestions()`). There is **no** redundant flat `questions` field stored at any pipeline stage.

Questions may be attached to:

* commit summaries
* **group histories** (primary at the current stage)
* cumulative report (§8)
* **prepared narrative** (§9; sole input to `final` / traceability for `deepen`)
* **RECONSTRUCTION.<project>.md** (§11; final human-facing deliverable; versioned by `deepen`, §10.5)

Questions should target exactly what Git cannot know:
```
Why was this module introduced?
Was this change used in production?
Was this related to a customer requirement?
Was this part of a security boundary?
Was this replacing a manual process?
Did this affect multiple tenants or realms?
Was this your own design, your implementation, or maintenance of someone else's work?
```

The system must support **answering** questions via the `final` command (§11), because the loop "system asks → user answers → context is recovered" is the actual product. A question with no path to an answer is incomplete. **`deepen`** (§10.5) extends that loop when the user remembers additional non-code context after `final`.

### Q&A storage (finish question files)

Human answers are **not** persisted on the prepared record (`prepared/<reportId>.json`). Storing Q&A there would cause `prepare` to treat questions as already answered on the next incremental run. Instead, Q&A lives in the **finish** chain as three cooperating pieces:

| Piece | Where | What |
|-------|--------|------|
| **Question text** | `finish/<finishId>.question.json` (v1) or `finish/<finishId>.question.vN.json` (v2+) | Up to four `{ id, question }` entries per round; `id` = Unix-ms timestamp at creation |
| **Answers** | `finish/<finishId>.json` (or `.vN.json`) | Cumulative `{ questionId, answer }[]` — references ids, does **not** repeat question text |
| **Question rounds** | `sourceQuestions` on the finish archive | Map `{ "<finishId>": ["v1", "v2", …] }` — which question-file rounds exist; **not** file-name links |

**Version labels** (`v1`, `v2`, …) align with the finish-chain cursor:

| Label | Question file on disk |
|-------|------------------------|
| `v1` | `<finishId>.question.json` |
| `v2` | `<finishId>.question.v2.json` |
| `vN` | `<finishId>.question.vN.json` |

Example after first `final` and one `deepen`:

```json
{
  "finishId": 1759696393,
  "version": 2,
  "sourceQuestions": { "1759696393": ["v1", "v2"] },
  "answers": [
    { "questionId": "1759696393000", "answer": "Staging only." },
    { "questionId": "1759696393100", "answer": "Yes, after the security review." }
  ]
}
```

`prepare` reads prior Q&A by loading `latestFinish()` → resolving `answers[]` against the question files listed in `sourceQuestions` (and on disk). `final` / `deepen` write a **new question file per round** and extend `sourceQuestions`; re-running `final` on the **same** finish version reuses saved answers when every question in that round's file is already answered.

**Legacy:** older finish archives may carry inline `{ question, answer }` pairs or a string `sourceQuestions` file name; readers normalize these when resolving Q&A.

⸻

## 8. Cumulative report (`report`)

The `report` command folds the work-session groups (§4) into a single growing narrative — an **incremental reduce over groups**, oldest first. It answers "what did I do across this whole repo?" by merging sessions, collapsing duplicates, and keeping only what stays significant as the picture grows.

Only groups that have a model layer are folded; groups without one are skipped and disclosed. All report LLM sessions include the **project context block** (§0).

### Fold model

```
report_1 = init(group_1)
report_2 = merge(report_1, group_2)
report_3 = merge(report_2, group_3)
...
report_N = merge(report_{N-1}, group_N)
```

Every intermediate report is written; the **final report** is the last in the chain. The chain is preserved so the accumulation is inspectable — and so the fold is **resumable**: a re-run loads the longest existing prefix of report files and continues from the next group (see §13).

### File layout

```
~/.workgraph/data/repos/<repo-id>/reports/<timestampEnd>.json
```

`<timestampEnd>` is the `timestampEnd` of the **latest group folded** into that report (so files sort chronologically and the highest-numbered file is the final report).

### Report JSON schema

```json
{
  "schemaVersion": 1000000,
  "reportId": 1591444361,
  "sourceGroups": ["1579390000.json", "1591444361.json"],
  "groupCount": 2,

  "deterministic": {
    "changedFiles": { "added": [], "deleted": [], "modified": [], "renamed": [] },
    "linesAdded": 0,
    "linesDeleted": 0,
    "importantFolders": [],
    "areas": [],
    "excludedFiles": [],
    "historySource": [
      ["1579390000.json", "1591444361.json"]
    ]
  },

  "model": {
    "changeTypes": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": { "technical": [], "architecture": [], "security": [] },
    "questionsAnalyses": [
      { "observation": [], "missingPiece": [], "question": [] }
    ],
    "confidence": "low | medium | high",
    "hiContext": [],
    "mediumContext": [],
    "lowContext": [],
    "provenance": { "model": "...", "generatedAt": "..." }
  },

  "history": [
    { "text": "..." }
  ],

  "mergeCursor": 0,

  "mergedFrom": {
    "previousReportId": 1579390000,
    "previousReportFile": "1579390000.json",
    "groupFile": "1591444361.json"
  }
}
```

Differences from a group record:

* **No commit hashes.** Provenance is by group **file name**, not hashes. **`sourceGroups`** (report root, next to `deterministic` and `model`) is the cumulative list of every group file folded so far (including routine-only folds). **`deterministic.historySource`** is **parallel to `history`** — same length, same indices (`0 … MAX_HISTORY_ENTRIES − 1`): `history[i]` is the narrative text; `historySource[i]` lists the group files that contributed to that entry. Cumulative provenance stays at the root; per-entry provenance stays in the deterministic layer; `history` carries text only.
* **Signals stay single** `low/medium/high` (the **max** across folded groups), but **`signalReasons` are arrays** (the merged, deduped reasons from all folded groups).
* **`history`** (not "summary" — this is a fuller account of what was done) is a **bounded** running list (≤ `MAX_HISTORY_ENTRIES`, i.e. 12) of `{ text }` objects — **text only**. Index `i` in `history` always pairs with index `i` in `deterministic.historySource`. A new session's entry is added only when it contributes something not already there; when the list exceeds the cap, **exactly one adjacent pair** is merged via a **rolling cursor** (below), unioning the corresponding `historySource[i]` and `historySource[i + 1]` rows into one.
* **`mergeCursor`** (optional, 0-based) — the rolling compaction pointer: the index of the first entry in the next pair to merge. It advances down the list each time compaction fires and wraps to the oldest, so compression is spread evenly across all ages instead of repeatedly re-squashing the oldest blob. Absent on legacy records ⇒ treated as `0`.
* **`mergedFrom`** (optional) — records **which fold produced this report**: the prior report it built on (`previousReportId` + `previousReportFile`) and the group file folded into it (`groupFile`). Where `sourceGroups` is the cumulative list of every group folded so far, `mergedFrom` names just the **single merge step** that created this file, so each report in the chain discloses its immediate parent report and the one group that was added. Absent on the **seeded** first report (`init(group_1)`) — nothing was merged — and on legacy records.

> **Legacy format:** older report files may still have `{ text, sourceGroups }` on history entries, a transitional nested `deterministic.sourceGroups`, or an offset `historySource` where row `0` was cumulative and rows `1..N` aligned with `history`. The reader accepts all of these; new writes keep cumulative provenance in root-level `sourceGroups` and per-entry provenance in the parallel `deterministic.historySource` array.

### `merge(report, group)`

**Routine gate (step 1 — one cheap LLM call).** A small classifier session decides whether the group is **ONLY routine upkeep** (dependency bumps, version/release updates, build-config/formatting/CI) versus **substantive** (design, implementation, real refactor, feature, bug fix, security). It reads the group's own `history` + signals + changeTypes (a small prompt) and returns `{ routine }`; when in doubt it answers `false`. A classifier (rather than a deterministic check) is used because per-commit/per-group labels alone don't reliably tell upkeep from real work. If **routine**, the group is folded **deterministically** (accumulate evidence + append the group file to `sourceGroups`, union `changeTypes`, ensure the single generic maintenance bullet, leave `history` and `historySource` untouched) and the heavier sessions are skipped — so a routine group costs **one** small LLM call instead of three. Only **substantive** groups run the merge/add/compact sessions below.

**Deterministic (pure code):** union `changedFiles` / `importantFolders` / `areas` / `excludedFiles`, sum churn, append the group file name to `sourceGroups`, maintain the parallel `historySource` rows (same indices as `history`) for compaction, and set `mergedFrom` to the prior report (`previousReportId` / `previousReportFile`) and the folded `groupFile` — both on the routine and the substantive path.

**Signals (pure code):** each `*Signal` = `max(report, group)` on the `low < medium < high` scale.

**Model-merge — one LLM session.** Given the report's model and the group's model, produce:

* `changeTypes` — union; near-duplicate tags merged.
* `signalReasons.{technical,architecture,security}` — **arrays**, with duplicate / near-duplicate reasons collapsed.
* `questionsAnalyses` — **rebuilt** for the combined work from **both** sides' `questionsAnalyses` (same aggregated `{ observation: [], missingPiece: [], question: [] }` shape as a group). **Thread identity** is decided primarily from whether entries share the same `missingPiece` (human context Git cannot show), supported by overlapping `observation` — not from question wording alone. **Within a thread**, union `observation` and `missingPiece` (drop duplicates); in `question` keep **one best** question per thread (read each candidate's meaning; pick or rewrite the sharpest formulation — do not accumulate multiple question strings for the same thread). **Value-rank** threads for the developer's role (production use, ownership, security boundary, major design decisions outrank minor clarifications and routine upkeep; questions tied to hi-tier / high-signal work outrank low-tier-only threads). Drop threads already answered, pure duplicates, and routine upkeep (never an entry for routine-only work). **Bound** to ≤ `MAX_CONTEXT_BULLETS` entries; when over the limit, merge near-duplicate threads and **drop the least valuable**, listing the **most important threads first**. The merge prompt renders each thread with observations, missing pieces, and questions on **separate numbered lines** so the model can read them distinctly.
* `confidence` — re-assessed for the combined work.
* `hiContext` / `mediumContext` / `lowContext` — merge duplicate/similar bullets, then **re-rank importance DOWNWARD ONLY** (a minor `hi` bullet may be merged or demoted; nothing is ever promoted), and **bound each tier to ≤ `MAX_CONTEXT_BULLETS`** — when over, drop the least important, keeping the bullets **most relevant to the developer's role** (from the project context). A hard code-side slice backstops the cap.

**History — append + compaction** (bounded so the report scales to large repos). The `history` is a fuller account, not a terse summary; the tiers control **depth of detail**: **HIGH is mandatory** (in detail); **MEDIUM must be mentioned** (briefly); **LOW is optional**. LLM history sessions return **text only** (`{ needed, text }` or `{ history: [strings] }`); **`sourceGroups` and `historySource` are never model output** — the CLI sets them deterministically when appending or compacting.

1. **Add only if new** (one LLM session): given the running history + current tiers + the new group's `history`, decide whether the new session adds anything not already captured. If yes, append `{ text }` to `history` and `[thisGroup]` to `historySource` at the **same index** (code-side); if not, add nothing. The whole list is **not** rewritten each fold — that linear-rewrite was O(N²) and did not scale.
2. **Compaction — rolling merge cursor** (one LLM session, only when over the cap): when the list exceeds `MAX_HISTORY_ENTRIES`, merge **exactly the pair at `mergeCursor`** (that entry + its newer neighbour) into one role-prioritized entry, union `historySource[cursor]` and `historySource[cursor + 1]`, then **advance the cursor** down the list (wrapping to the oldest after the last pair). The list returns to ≤ `MAX_HISTORY_ENTRIES`. Because each fold adds at most one entry, exactly one pair is merged per overflow. The pair is always taken from positions `0 … MAX_HISTORY_ENTRIES-2`, so the **newest entry is never merged** — it stays verbatim until the cursor reaches it on a later pass. This spreads compression evenly across all ages, so no single "oldest" blob is repeatedly re-summarized (which would degrade it through lossy re-paraphrasing). Example (cap = 4, cursor starts at `0`):

   ```
   [A, B, C, D]            cursor@0
   +E → [A+B, C, D, E]     cursor@1
   +F → [A+B, C+D, E, F]   cursor@2
   +G → [A+B, C+D, E+F, G] cursor@0 (wrapped)
   +H → [ABCD, E+F, G, H]  cursor@1
   ```

**Routine maintenance is collapsed, not enumerated.** All three report sessions (merge, add-if-new, compact) treat dependency bumps, version/release updates, lockfile/build-config tweaks, formatting, and CI upkeep as **one generic low-tier item** ("ongoing maintenance: dependency updates, version releases, build/CI upkeep") — the specific version or dependency does not matter. No per-release or per-bump entries; a routine-only session adds nothing when a maintenance mention already exists. This keeps upkeep distinct from substantive design/implementation work.

Because both contexts (≤ `MAX_CONTEXT_BULLETS`/tier) and history (≤ `MAX_HISTORY_ENTRIES`) are bounded, each fold's prompts are bounded — total cost is **O(N · cap)** rather than O(N²).

`init(group_1)` = `merge` against an empty report: signals / context tiers / `changeTypes` / `questionsAnalyses` copied across, each `signalReasons` value lifted into a single-element array, `history` seeded with `{ text: group.history }`, `sourceGroups` set to `[group_1]`, and `historySource` set to `[[group_1]]` — index `0` in both arrays. The seeded report has **no** `mergedFrom` — nothing was merged into it.

### Voice & honesty

First person ('I'), never "the team" / "they" / "we". No overclaiming — production usage, ownership, and impact stay in open questions (`questionsAnalyses`), not in statements. The report reconstructs and asks; it does not judge.

### Deterministic rollup (optional read-only view)

A human-facing text view may be **derived** from the final report (not stored as state): group/area counts, top areas by activity and churn, areas quiet for a long time ("forgotten-work candidates"), the most common questions, and disclosed limitations (groups without a model layer, files excluded as noise).

Example:

```
Groups folded: 42  (2 skipped: no model layer)
Areas detected: 18 · excluded as noise: 4,212 files

Signals (max across work): technical=high · architecture=high · security=medium

Top areas by activity:
- keycloak-plugins   (181 commits across 12 groups)
- backend            (61 commits)
- docker             (33 commits)

Open questions to recover context (top):
- Was the AWS delivery work used in production?
- Was the Keycloak plugin my own design or maintenance?

Limitations:
- Impact, ownership, and production usage are NOT inferred — confirm via questions.
- 2 groups unsummarized; 4,212 files excluded as noise.
```

⸻

## 9. Prepared narrative (`prepare`)

After `report` produces the final cumulative report, `prepare` distills it into a **single role-aligned narrative** — the human-facing deliverable that answers "what did I do on this project, in terms that matter for my role?"

`prepare` reads the **latest report** (the report file with the highest `reportId` / `timestampEnd` in `reports/`), combines it with `project.json` (role + prepared story + profile), and writes a compact prepared record. All LLM sessions use the **`narrativeModel`** (§13).

### Inputs

1. **Latest report** — `~/.workgraph/data/repos/<repo-id>/reports/<reportId>.json` (the final fold in the chain).
2. **Project context** — `project.json` from `init` (§0): role, `story.preparedContext`, `profile`.

Precondition: both `project.json` and at least one report file must exist. If `prepare` was already run for this report, skip.

### Processing steps

**Step 1 — Concatenate report history (deterministic, no model).**

From the report's `history` array, join every `history[].text` into one block, **each entry on its own line** (newline-separated). This is `rawHistory` — input to the LLM, not stored as the final output.

**Step 2 — Compose unified history (one LLM session).**

Given:

* developer **role**;
* `story.preparedContext` and `profile` from `project.json`;
* `rawHistory`;
* report signals and `changeTypes` (for grounding, not for copying verbatim).

Produce a **single first-person `history` string** — a completely rewritten narrative that merges the report's history entries into one coherent account. The model must:

* prioritize what matters for the developer's role;
* align with the project story and profile (no contradictions);
* de-emphasize routine upkeep already collapsed in the report;
* never overclaim production usage, ownership, or impact.

**Step 3 — Clean technologies (one LLM session, skipped when none).**

Given the report's accumulated `technologies` list, dedupe and collapse near-duplicates (e.g. JS subsumed by TS), capped at five entries.

**Step 4 — Copy signals and change types (deterministic, no model).**

From the report's `model`, copy unchanged:

* `changeTypes`
* `technicalSignal`, `architectureSignal`, `securitySignal`

**Step 5 — Collapse signal reasons (one LLM session).**

Given the report's `signalReasons` arrays (`technical`, `architecture`, `security`), the **composed `history`** from step 2, and project context (role + story + profile), produce exactly **four** reason strings — a flat array that captures why the three signals are what they are, reframed for the role and the unified narrative. Near-duplicate reasons from the report arrays are merged; minor upkeep reasons are dropped.

**Step 6 — Reframe questionsAnalyses (one LLM session).**

Given the composed `history`, the four collapsed `signalReasons`, the report's existing `questionsAnalyses`, **prior human Q&A from the latest finish archive** (when present — `latestFinish()` → resolve `answers[]` via `sourceQuestions` + question files; do not repeat those threads), and project context (role + story + profile), produce up to **four** `questionsAnalyses` entries — role-aware reasoned threads that target **new** gaps (especially work added since the last report), not questions already answered in a prior finish round. Each entry uses the aggregated shape `{ observation: [], missingPiece: [], question: [] }` (usually one question string per entry). Questions must target what Git still cannot know; do not repeat facts already in `project.json`. `confidence` is re-assessed alongside this step.

The prepared record stores **only these four active question threads** (`model.questionsAnalyses`). It does **not** store human answers — the canonical Q&A archive is the finish chain (§7, §11).

**Step 7 — Console preview (deterministic, no model).**

After the prepared record is written, `prepare` prints a readable preview to the console: the **unified `history`** as one block, followed by the **question strings** derived from `questionsAnalyses` (numbered, up to four). This makes the upcoming `final` step transparent — the user sees the reconstructed narrative and exactly which questions they will be asked before running `final`.

### File layout

```
~/.workgraph/data/repos/<repo-id>/prepared/<reportId>.json
```

`<reportId>` matches the source report's `reportId` (same as the report filename stem). Example:

```
~/.workgraph/data/repos/keycloak-radius-plugin-920018a3/prepared/1759696393.json
```

### Prepared JSON schema

```json
{
  "schemaVersion": 1000000,
  "preparedId": 1759696393,
  "sourceReport": "1759696393.json",
  "groupCount": 65,

  "model": {
    "changeTypes": [],
    "technologies": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": [],
    "questionsAnalyses": [
      { "observation": [], "missingPiece": [], "question": [] }
    ],
    "confidence": "low | medium | high",
    "history": "...",
    "provenance": {
      "model": "...",
      "generatedAt": "...",
      "sourceReport": "1759696393.json"
    }
  }
}
```

Field notes:

* **`schemaVersion`** — encoded CLI semver when written (§1.5).
* **`sourceReport`** — link to the report file by name (no commit hashes).
* **`changeTypes` / `*Signal`** — copied from the report (step 4).
* **`technologies`** — cleaned/deduped list from the report (step 3); capped at five.
* **`signalReasons`** — exactly **four** strings (step 5); not split by technical/architecture/security.
* **`questionsAnalyses`** — up to **four** reasoned threads (step 6); role-aware. Interactive Q&A uses the `question` strings (`flattenQuestions()` in code); answers are collected later in `final` / `deepen` and stored under `finish/` (§7).
* **`history`** — single unified narrative string (step 2); replaces the report's multi-entry `history` array.
* **`confidence`** — re-assessed in step 6 alongside `questionsAnalyses`, or copied from the report when unchanged.
* **No `answers` field** — legacy prepared files may still carry a deprecated `answers` block; readers ignore it. Q&A lives on the finish archive + question files.
* **No `deterministic` layer**, no `hiContext` / `mediumContext` / `lowContext`, no per-group provenance — the prepared record is interpretation for human review, grounded in the report + project context.

`prepare` is **idempotent per report**: if `prepared/<reportId>.json` exists, skip.

### Voice & honesty

Same rules as `report` (§8): first person ('I'), no overclaiming. The prepared narrative reconstructs and asks; it does not judge or score achievements.

⸻

## 11. Final deliverable (`final`)

The last pipeline step runs **only on the `prepare` result** (`prepared/<reportId>.json`, §9). It closes the loop: the system presents up to **four questions per round** from the prepared record (or only **new** questions in extension mode), the human answers them, and three `narrativeModel` LLM sessions produce the deliverable — first a **refined "Your IMPACT" narrative** that weaves the answers into the reconstructed history, then a **Role Narrative** of four impact bullet points framed for the selected role, then **CV bullets** (four impersonal, action-oriented lines). Everything is written to a markdown file in the **current working directory** (where the CLI was launched), not under `~/.workgraph`.

`final` is **interactive** — it requires human input that cannot be gathered upfront (the questions only exist after `prepare`). It runs as the **last stage of `run`** (after `prepare`), and can also be run on its own.

### Inputs

1. **Latest prepared record** — `~/.workgraph/data/repos/<repo-id>/prepared/<reportId>.json` (output of `prepare`, §9). `final` does not read the report or groups directly — only `prepare` + `project.json`.
2. **Project context** — `project.json` (role, `story.preparedContext`, `profile`).
3. **Latest finish archive** (extension mode only) — when a prior finish with saved `answers` exists and the latest prepared file is **new** (`prepared/<newReportId>.json` ≠ `priorFinish.sourcePrepared`), `final` loads **`latestFinish()`** (highest `version` — e.g. `*.v10.json`) and treats its `answers[]` as the cumulative Q&A baseline.

Precondition: `prepare` must have completed.

### Q&A artifact model (this step)

See §7 for the full picture. In short:

1. **`final` writes question text** to `finish/<finishId>.question.json` (v1) or `.question.vN.json` (extension / deepen) — one file **per round**, up to four `{ id, question }` entries.
2. **`final` writes answers** to the finish archive as `{ questionId, answer }[]` (cumulative in extension mode).
3. **`sourceQuestions`** on the finish record lists which question rounds exist: `{ "<finishId>": ["v1", "v2", …] }` — not paths to files. Disk layout follows the label table in §7.

**First run** (no prior finish, or same prepared as prior finish): present up to four questions from the latest prepared record; if the paired **finish question file** and finish archive already hold complete answers for this round, reuse them (no re-prompt).

**Extension mode** (incremental pipeline after new commits): prior finish has answers **and** `latestPrepared.file !== priorFinish.sourcePrepared`. Ask only **new** question strings from the latest prepare (up to four), **excluding** questions whose normalized text already appears in prior Q&A. Write a **new** question file (`<id>.question.vN.json`) for the new round only. Merge **prior + new** answers into cumulative `answers[]` on the new finish archive (e.g. 4 prior + 4 new → 8). Narrative sessions resolve question text via the question-file catalog. Append the next finish version (`v11` after `v10`) — **do not overwrite** prior finish files. Write `RECONSTRUCTION.<project>.vN.md` to cwd when `N > 1`.

If every prepared question duplicates prior answers, skip the Q&A prompt and **regenerate narrative only** from existing cumulative Q&A + updated prepared history.

### Step 1 — Collect answers (interactive, no model)

Present each question string to ask (derived from `model.questionsAnalyses` via `flattenQuestions()`, capped at four per round). In **extension mode**, only **new** questions not already answered in the latest finish are presented. Multi-line input allowed.

Questions for this round are stored in a **separate question file** next to the finish archive (not in `prepared/`):

```
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.question.json       # v1
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.question.vN.json   # extension / deepen
```

```json
{
  "schemaVersion": 1000000,
  "sourceFinal": "1759696393.json",
  "sourceReport": "1759696393.json",
  "questions": [
    { "id": "1759696393000", "question": "Was this deployed to production?" }
  ]
}
```

Each `id` is the **Unix-ms timestamp** when the question was created (unique within the finish chain). Answers on the finish archive reference these ids — they do **not** repeat the question text. The finish record's **`sourceQuestions`** map lists which question rounds were written (see §7):

```json
{
  "sourceQuestions": { "1759696393": ["v1"] },
  "answers": [
    { "questionId": "1759696393000", "answer": "Staging only." }
  ]
}
```

After extension or `deepen`, `sourceQuestions` grows cumulatively, e.g. `{ "1759696393": ["v1", "v2"] }`, while `answers[]` holds **all** rounds' `{ questionId, answer }` entries. Question text for prompts and markdown is resolved by loading every question file for the labels in `sourceQuestions`.

Re-running `final` on the same finish version reuses the existing question file and saved answers when every question is already answered.

A `--answers-file <path>` flag may supply pre-written answers as JSON (non-interactive). In extension mode the file should contain answers for the **new** questions only (aligned by order with the new question file); they are appended after prior finish `answers`.

### Step 2a — Refine "Your IMPACT" with the answers (one LLM session, `narrativeModel`)

The prepared `model.history` is a reconstruction from Git evidence alone (§9). Now that the human has answered the open questions, refine it so the narrative reflects the **confirmed** ownership, intent, and context.

Given:

* `model.history` from the prepared record (the Git reconstruction);
* in **extension mode**, also **prior `finish.history`** (combined like `deepen` — prepare baseline + prior final);
* project context from `project.json` (role, `story.preparedContext`, `profile`);
* **all** question–answer pairs for this round (four on first run; **cumulative** prior + new in extension mode).

Produce **one** refined first-person `history` string — the same flowing-prose form as the prepared history, with the answers woven in. Rules:

* use ONLY what the history shows or what the human stated in an answer — **invent nothing**;
* if an answer is empty or "I don't remember", keep the original reconstruction for that part;
* never overclaim production usage, customer impact, or org-wide adoption beyond what was stated;
* same **technical, claim-safe tone** as the Role Narrative below (no hype words, plain verbs, flowing prose — no Q/A formatting, no tier headers).

On model failure / empty output, fall back to the prepared `model.history` verbatim. This refined string is what fills the **`## Your IMPACT`** section, and it is the `history` fed into the Role Narrative below (so both sections stay consistent). It is written to the markdown only; the prepared record is not modified.

### Step 2b — Role Narrative (one LLM session, `narrativeModel`)

Given:

* the **refined `history`** from step 2a;
* project context from `project.json` (role, `story.preparedContext`, `profile`);
* `model.signalReasons` (the four collapsed reasons);
* **all** question–answer pairs from step 1 (cumulative in extension mode).

Produce exactly **four** impact bullet points — the **Role Narrative**. Each bullet describes the developer's impact on the project **as the selected role**, grounded in the history, signal reasons, and the human's own answers. Rules:

* first person ('I');
* describe *what was done and where* — never invent production usage, customer impact, or org-wide adoption unless the human stated it in an answer;
* frame emphasis according to role seniority (§0);
* **technical, claim-safe tone — not marketing:** write engineer-to-engineer, naming the actual components/protocols/mechanisms and design decisions; ban hype words (spearheaded, revolutionized, robust, seamless, leveraged, game-changing, etc.) and prefer plain verbs (implemented, added, refactored, designed, fixed, migrated);
* no numeric scores or superlatives ("best", "led the entire org").


### Step 2c — CV bullets (one LLM session, `narrativeModel`)

After the Role Narrative, produce exactly **four** impersonal CV/resume bullets — shorter, action-oriented, **no first person** (no I/my/we). Start each with a past-tense verb; frame emphasis to the developer's role (see §0 and `ROLE_CV_EMPHASIS` in prompts). Same claim-safety bar as the Role Narrative. Input: refined history, signal reasons, cumulative Q&A, and the four Role Narrative bullets as reference.

### Step 3 — Write `RECONSTRUCTION.<project>.md` (deterministic assembly)

Write a markdown file to the **process current working directory** (`process.cwd()`, not the repo path):

```
RECONSTRUCTION.<project>.md
```

`<project>` is the repository **basename** (e.g. `keycloak-radius-plugin` → `RECONSTRUCTION.keycloak-radius-plugin.md`). A `--output <path>` flag overrides the filename.

#### File structure

```markdown
## PROJECT DESCRIPTION

{from project.json → profile.summary; optionally profile.domains / apparentStack as brief context}

## Your IMPACT as {ROLE}

{refined history from step 2a — the unified first-person narrative, with the human's answers woven in}

## Technologies

{cleaned, deduped, class-collapsed technology list from `prepare` (§9) — comma-separated}

## Impact bullet points (Role Narrative)

- {role narrative bullet 1}
- {role narrative bullet 2}
- {role narrative bullet 3}
- {role narrative bullet 4}
## CV bullets

- {cv bullet 1}
- {cv bullet 2}
- {cv bullet 3}
- {cv bullet 4}

## Possible questions

**Q:** {question 1}
**A:** {answer 1}

**Q:** {question 2}
**A:** {answer 2}

**Q:** {question 3}
**A:** {answer 3}

**Q:** {question 4}
**A:** {answer 4}
```

`{ROLE}` is the developer role from config / `project.json` (e.g. `Senior Developer`).

The markdown file is the **final human-facing deliverable**. Re-running `final` on the same prepared reuses saved answers and regenerates narrative from them.

### Step 4 — Archive under the repo's finish dir

In addition to the cwd markdown, `final` writes the result into the repo's data namespace so it is linked back into the chain:

```
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.md           # copy of the result markdown
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.json         # finish record (links to prepared + question file)
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.question.json
```

`<preparedId>` matches the source prepared record's id (and the report it came from). The JSON record:

```json
{
  "schemaVersion": 1000000,
  "finishId": 1759696393,
  "version": 1,
  "sourcePrepared": "1759696393.json",
  "sourceReport": "1759696393.json",
  "project": "<repo-basename>",
  "role": "Senior Developer",
  "technologies": [],
  "history": "...",
  "narrative": ["...", "...", "...", "..."],
  "cvBullets": ["...", "...", "...", "..."],
  "sourceQuestions": { "1759696393": ["v1"] },
  "answers": [{ "questionId": "1759696393000", "answer": "..." }],
  "outputMarkdown": "1759696393.md",
  "provenance": { "model": "...", "generatedAt": "..." }
}
```

Provenance is by file name only (`sourcePrepared` → `prepared/<id>.json` → `reports/<id>.json`); no commit hashes. **`version`** is `1` for the initial `final` (finish-chain cursor — not `schemaVersion`; see §1.5). **`sourceQuestions`** maps `finishId` → question-round labels (`v1`, `v2`, …); question files on disk follow `<finishId>.question.json` / `<finishId>.question.vN.json`. **Extension mode** (new prepared after incremental commits) appends `<preparedId>.vN.json` like **`deepen`** — prior versions are never overwritten. In extension mode the finish record also sets **`sourcePreviousFinish`** to the prior archive file name. **`deepen`** (§10.5) uses the same version cursor, cumulative `answers[]`, and `sourceQuestions` semantics without re-running `report`/`prepare`.

### Voice & honesty

The Role Narrative bullets are interpretation informed by human answers — they are **confirmed context**, not proof. If an answer is vague, the bullets must stay tentative ("I built X; production usage unconfirmed") rather than upgrading claims.

⸻

## 10.5 Narrative extension (`deepen`)

Optional step **after `final`**. It does **not** re-run `report` or `prepare`. It extends the latest finish archive with **four new follow-up questions**, human answers, a refined **Your IMPACT** narrative, and an updated Role Narrative — producing a **new versioned** finish record and markdown **without overwriting** the prior `final`. The same **cumulative Q&A + version append** pattern also applies when **`final`** runs in **extension mode** after an incremental `run` (new report → new prepared); see §11.

`deepen` is **interactive** (recalled context + four new Q&A). It is **not** part of `run`.

### Inputs (via provenance chain)

1. **Latest finish archive** — `~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.json` (or `<preparedId>.vN.json` if a prior `deepen` exists). The loader picks the record with the highest **`version`** cursor.
2. **Prepared record** — loaded via `finish.sourcePrepared` → `prepared/<reportId>.json` (for `model.history`, `signalReasons`, `model.questionsAnalyses`).
3. **Report** — loaded via `finish.sourceReport` → `reports/<reportId>.json` (for `model.questionsAnalyses` as context only).
4. **Project context** — `project.json` (role, `story.preparedContext`, `profile`) in every LLM system prompt.

`deepen` does **not** read groups, commits, or evidence files directly — only through the finish → prepared → report file chain (same provenance as `final`).

### Combined history baseline

Before any LLM step, history is assembled as **two layers in one text block**:

```
Baseline from prepare:
{prepared.model.history}

Refined after prior final:
{priorFinish.history}
```

This combined block feeds **follow-up question generation**. **Refine IMPACT** uses the same two layers plus **all** Q&A (prior answers from the finish record **plus** the four new answers) and the newly recalled context.

### Step 1 — Recalled context (interactive, no model)

Prompt the user (multi-line editor) for **non-code context** they remembered about working on the project — team decisions, constraints, handoffs, pivots, meetings, why something mattered; **not** visible in Git. Optional `--context-file <path>` supplies plain text non-interactively.

This is **starting context**, not proof. It shapes the four new questions and the refined narrative but must not inflate impact unless the user stated it explicitly.

### Step 2 — Four new follow-up questionsAnalyses (one LLM session, `narrativeModel`)

Given:

* **project context block** (§0);
* **recalled context** from step 1;
* **combined history** (prepare baseline + prior final history);
* report `model.questionsAnalyses`, prepared `model.questionsAnalyses` (as flattened question strings for context), and **all prior Q&A** from the finish record;
* prepared `signalReasons`.

Produce up to **four new** `questionsAnalyses` entries (aggregated shape) whose `question` strings are role-aware follow-ups that:

* target gaps **still** not covered after prior Q&A and the recalled context;
* do **not** repeat, rephrase, or narrow the same angle as any prior question;
* follow the same role-aware rules as `prepare` (§7, §9).

The CLI derives the four interactive question strings from the result via `flattenQuestions()`.

### Step 3 — Collect answers to the four new questions (interactive, no model)

Same UX as `final` step 1 (multi-line editor per question). New questions are written to `<preparedId>.question.vN.json` (e.g. `.question.v2.json` on first `deepen`) with `{ id, question }` entries. `sourceQuestions` on the new finish record extends the prior map with the new label (e.g. `["v1", "v2"]`). `--answers-file <path>` accepts JSON for the **four new** answers only (non-interactive; aligned by order with the new question file).

**All Q&A** for downstream steps = prior finish `answers[]` **concatenated with** the four new `{ questionId, answer }` entries (8 after the first `deepen`, 12 after the second, …). Question text is resolved from the question-file catalog across all rounds.

### Step 4a — Refine "Your IMPACT" (one LLM session, `narrativeModel`)

Same rules as `final` step 2a, but the user prompt includes:

* combined history (prepare + prior final);
* **all** Q&A (prior + new);
* **recalled context** from step 1.

On failure, fall back to the combined history baseline.

### Step 4b — Role Narrative (one LLM session, `narrativeModel`)

Same rules as `final` step 2b: four bullets from refined history + `signalReasons` + **all** Q&A + project context (+ recalled context in the user prompt).

### Step 4c — CV bullets (one LLM session, `narrativeModel`)

Same rules as `final` step 2c: four impersonal, role-calibrated CV bullets from refined history, signal reasons, all Q&A, and the Role Narrative bullets.

### Step 5 — Write versioned markdown (deterministic assembly)

Same sections as `final` (including **CV bullets**), plus **`## Recalled context (this deepen round)`** when step 1 was non-empty. All Q&A pairs (prior + new) appear under **Possible questions**.

**Default cwd output** (does not overwrite v1):

| Finish `version` | Markdown in cwd |
|------------------|-----------------|
| `2` | `RECONSTRUCTION.<project>.v2.md` |
| `3` | `RECONSTRUCTION.<project>.v3.md` |
| … | … |

With `--period`: `RECONSTRUCTION.<project>.<period>.v2.md`, etc. `--output <path>` overrides.

### Step 6 — Versioned finish archive (append-only)

**Never overwrites** the prior finish file. The next version uses the same **`finishId`** (prepared/report id) with a version suffix:

```
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.json       # version 1 (`final`)
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.md
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.question.json
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.v2.json  # first `deepen`
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.v2.md
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.question.v2.json
~/.workgraph/data/repos/<repo-id>/finish/<preparedId>.v3.json  # second `deepen`
…
```

#### Finish record (version ≥ 2)

Same fields as §11 step 4, plus:

```json
{
  "schemaVersion": 1000000,
  "finishId": 1759696393,
  "version": 2,
  "sourcePrepared": "1759696393.json",
  "sourceReport": "1759696393.json",
  "sourcePreviousFinish": "1759696393.json",
  "recalledContext": "After the security review we pivoted the rollout plan…",
  "project": "<repo-basename>",
  "role": "Senior Developer",
  "technologies": [],
  "history": "...",
  "narrative": ["...", "...", "...", "..."],
  "cvBullets": ["...", "...", "...", "..."],
  "sourceQuestions": { "1759696393": ["v1", "v2"] },
  "answers": [{ "questionId": "1759696394000", "answer": "…" }],
  "outputMarkdown": "1759696393.v2.md",
  "provenance": { "model": "...", "generatedAt": "..." }
}
```

* **`version`** — monotonic **finish-chain** cursor (`1` = initial `final`; each `deepen` **or** extension `final` increments). Not the CLI package semver — see **`schemaVersion`** (§1.5).
* **`sourcePreviousFinish`** — file name of the finish record this version extended.
* **`recalledContext`** — non-code context from step 1 (omitted if empty).
* **`answers`** — **cumulative** (all rounds, each entry `{ questionId, answer }`); after first `deepen`, length is 8; after extension `final` with a prior v10 finish, length is prior count + new answers (e.g. 44 → 48).
* **`sourceQuestions`** — map of finish id → question-file version labels (`v1`, `v2`, …); cumulative across rounds, e.g. `{ "1759696393": ["v1", "v2"] }`. Question files on disk follow `<id>.question.json` / `<id>.question.vN.json` (§7).

Re-running `deepen` against the **latest** finish produces the next version (`v3`, …). If the next version file already exists for the current latest, skip.

### Voice & honesty

Same as `final`. Recalled context and new answers are **confirmed context**, not proof of production impact.

⸻

## 11. Success criteria

Success looks like grouped summaries remind the user of forgotten work and ask questions that genuinely help recover missing context — from one real repository.

**Minimum success criteria:**

- `init` captures role, project story, and a usable project profile from README + story
- every LLM step after `init` receives project context; questions reflect developer role
- 100+ commits can be exported and processed
- every commit has a deterministic layer; most have a model summary
- commits are grouped into work sessions using a configurable day threshold
- every group has an aggregated deterministic layer; most have a group model summary
- `groups.tiers` and `model.hiContext` / `mediumContext` / `lowContext` are populated consistently with per-commit signals
- project areas are detected deterministically
- useful questions are generated (especially at group level)
- top areas and forgotten-work candidates look meaningful to the user
- `prepare` produces a readable unified history and up to four role-aligned `questionsAnalyses` entries from the final report
- `final` collects human responses (up to four new questions per round; cumulative Q&A in extension mode), archives question text in `finish/*.question.json` (+ `.question.vN.json`), answers + `sourceQuestions` on the finish record, and writes `RECONSTRUCTION.<project>.md` (or `.vN.md`) with a four-bullet Role Narrative
- `deepen` extends the latest finish with recalled non-code context, four new questions (new question file + extended `sourceQuestions`), cumulative `answers[]`, and a versioned finish archive (`*.v2.json`, …) without overwriting v1

**Strong success criteria:**

- group summaries reveal work the user had genuinely forgotten
- low-context commits are correctly de-emphasized without losing traceability
- model summaries are mostly accurate descriptions of the change (not of its importance)
- signal estimates with reasons match the user's own judgment of important subsystems
- answering the generated questions actually recovers ownership/intent/impact, and the Role Narrative reflects those answers
- at least 5 plausible workstream candidates emerge for the user to confirm

**Failure criteria:**

- summaries are too generic to be useful
- area membership is mostly wrong
- grouping splits obvious work sessions or merges unrelated bursts
- the report reveals nothing the user didn't already know
- too much noise from generated files or folder structure
- the local model cannot summarize patches or groups reliably (in which case: the deterministic layer alone must still pass minimum criteria)

> Note: because the deterministic layer carries the minimum criteria, the pipeline can succeed *even if the local model underperforms*. The model is an enhancement, not the foundation.

⸻

## 12. Out of scope

```
public profile / portfolio generation
PDF/DOCX export
numeric achievement scoring
multi-user support
cloud synchronization
full UI
advanced vector search
automatic Jira/GitHub integration
production-ready plugin system
```
These may be added later. The personal `RECONSTRUCTION.<project>.md` from `final` (and versioned `.v2.md`, … from `deepen`) is **in scope** — confirmed reconstruction artifacts, not a public portfolio.

⸻

## 13. Implementation

Command flow (all commands take the repository path, for consistency):
```
dev-workgraph check                 # verify Ollama is running + has models           [BUILT]
dev-workgraph init         ./repo   # role, project story, README → project profile   [BUILT]
dev-workgraph authors      ./repo   # scan history, select your author emails          [BUILT]
dev-workgraph evidence     ./repo   # extract commits + patches + deterministic JSON   [BUILT]
dev-workgraph summarize    ./repo   # add per-commit model layer via local Ollama      [BUILT]
dev-workgraph commit-group ./repo   # group commits by day threshold, 2 LLM sessions   [BUILT]
dev-workgraph report       ./repo   # fold groups into a cumulative narrative report   [BUILT]
dev-workgraph prepare      ./repo   # distill final report → role-aligned narrative    [BUILT]
dev-workgraph final        ./repo   # collect Q&A → finish/*.question.json + archive → RECONSTRUCTION.<project>.md [BUILT]
dev-workgraph deepen       ./repo   # extend latest finish: recalled context + 4 new Q&A → .question.vN.json + v2+ [BUILT]
dev-workgraph run          ./repo   # gather inputs upfront, run pipeline to prepare   [BUILT]
dev-workgraph export       ./repo   # bundle the repo's workgraph data + config → .tar.gz [BUILT]
dev-workgraph import       <bundle> # restore a bundle; add/update its config entry    [BUILT]
dev-workgraph init:period  ./repo   # define a review period, inherit project context  [BUILT]
dev-workgraph run:period   ./repo   # run the whole pipeline for a review period        [BUILT]
```

Every pipeline command also accepts a cross-cutting **`--period <id>`** flag (§0.5) to scope it to a defined review window; `init:period` / `run:period` are convenience aliases that force period mode. Period data lives under `~/.workgraph/data/repos/<repo-id>/periods/<id>/…` and is filtered to commits in `[from, to)`.

`init` should run once per repository before the first `summarize`. `authors`, `evidence`, and the deterministic part of `commit-group` work **without any model**. `init`, `summarize`, group model layers, `report`, `prepare`, and `final` (Role Narrative step) use the local LLM. **`final` runs at the END of `run`, after `prepare`** — it asks the four prepared questions interactively (they only exist after `prepare`), so it cannot be gathered upfront. `export`/`import` are **data-only** (no model): they move a repo's accumulated workgraph data between machines.

### Portability (`export` / `import`)

A repo's analysis lives in two places: the data directory `~/.workgraph/data/repos/<repo-id>/` (commits, groups, reports, prepared, finish, `project.json`) and the repo's entry in `~/.workgraph/config.json` → `repos[<abs-path>]` (selected authors, role, grouping settings) — which lives **outside** the data dir. `export` bundles both into a portable `.tar.gz`:

```
<repo-id>/…           # the whole data directory
manifest.json         # { schemaVersion, repoId, repoPath, exportedAt, config }
```

`manifest.config` is the repo's `config.json` entry. `manifest.schemaVersion` is the encoded CLI semver that produced the bundle (§1.5). `export <repo> [--output <path>]` writes `./<repo-id>.workgraph.tar.gz` by default (uses the system `tar`).

`import <bundle.tar.gz> [--repo <path>]` unpacks the data directory back under `~/.workgraph/data/repos/` and **adds or updates** the repo's `config.json` entry from the manifest. By default it restores to the manifest's original `repoId`/path; `--repo <path>` re-targets the data under a different repo path (recomputing the data-dir id). If data already exists for the target repo, `import` errors — remove the existing data directory manually before importing. Provenance throughout is by file name, never commit hashes.

### `run` — unattended pipeline

`check` is a standalone preflight: it verifies the Ollama server is reachable and has at least one model, and otherwise prints OS-specific install help (macOS: `brew install ollama`; Linux: `curl -fsSL https://ollama.com/install.sh | sh`) plus `ollama pull` suggestions; it also flags any saved `commitModel`/`reportModel`/`narrativeModel` that is no longer installed. `run` invokes the same check as a **preflight** and aborts before prompting if Ollama is not ready.

`run` is an orchestrator that **gathers every upfront input first** (after the Ollama preflight), then executes `init → evidence → summarize → commit-group → report → prepare` without further prompts, and finishes with **`final`** which asks the four prepared questions interactively. Upfront it asks only for what is missing: the three models (below), developer role + project story (if `project.json` is absent), author identities (if none saved), and the group-threshold days (if not saved). Each unattended stage runs with those values passed as flags. Stages skip work that is already done (append-only / resume / extension groups), so `run` is safe to re-run after new commits. On re-run, `evidence` and `summarize` process only new commits; `commit-group` writes **extension groups** for uncovered commits (§4); `report` resumes the fold chain; `prepare` runs for a new `reportId`; **`final`** enters **extension mode** when a finish with answers exists and the prepared file is new — asks up to four new questions, merges cumulative Q&A, and appends `finish` vN. On the **same** prepared, `final` reuses saved answers. `final` can also be run on its own. **`deepen`** is a separate post-`final` step (§10.5) — not invoked by `run`.

### Three models (commit-level vs report-level vs narrative)

The local model is chosen and remembered **per stage group**, in `~/.workgraph/config.json` under `ollama`:

- **`commitModel`** — used by `summarize` and `commit-group` (per-commit and per-session work).
- **`reportModel`** — used by `report` (cumulative fold over work-session groups).
- **`narrativeModel`** — used by `init`, `prepare`, `final`, and **`deepen`** (project context, human-facing narrative, Role Narrative, follow-up rounds).

Each command seeds its picker from its own slot, falling back through the more general slots — `narrativeModel ?? reportModel ?? model` for the narrative stages, `commitModel ?? model` for commit stages, `reportModel ?? model` for report — so an existing two-model setup keeps working until a separate narrative model is chosen. `--model` forces a single model for that command. `run` asks for all three upfront. This lets a fast model handle commit-level volume, a stronger model fold the report, and (optionally) a different model — tuned for prose/claim-safety — build project context and write the final narrative.

### Resilience

- **JSON validation:** every LLM call (`chatJson` in `src/lib/ollama.ts`) passes a JSON Schema via Ollama's `format` parameter; the response is extracted from raw text (markdown fences tolerated), parsed, and schema-validated before acceptance (`parseAndValidateModelJson` in `src/lib/json-response.ts`). Requests use `think: false` and **`temperature: 0.2` only** — `num_ctx` / `num_predict` are left to the model's Modelfile defaults.
- **Truncation:** `done_reason === "length"` does **not** fail by itself; if the response still parses and passes schema validation it is accepted (with a stderr warning). Truly truncated JSON fails at parse/schema validation like any other bad response.
- **Retries:** every LLM call retries up to **2 attempts** with backoff on HTTP/transport, parse, or validation errors. After exhaustion the stage throws and the pipeline stops at that item.
- **`report` resume:** each fold writes `reports/<timestampEnd>.json`, so a re-run loads the longest existing prefix and **continues from the next group** instead of restarting. Adding new groups later extends the chain incrementally.
- **`commit-group` extension:** on re-run, subtracts commits already in summarized groups and writes **extension groups** for uncovered tails only (§4).
- **`evidence`:** noise hunks removed via ignore profiles before write/split; `excludedFiles` recorded; oversized patches split into `.partN` files (24 k char cap per part).
- **`summarize`:** small commits → one LLM call; split commits → parts + deterministic merge + three finalize LLM calls → canonical `summaries/<ts>/<hash>.json`; empty/noise-only patches → empty layer with `provenance.model: "(none)"` (no LLM).
- **`commit-group`:** excludes empty summaries (`"(none)"` / blank `summary`) before grouping; split commits join only after canonical summary exists.
- **`final` extension:** when latest prepared ≠ prior `sourcePrepared`, loads `latestFinish()` cumulative `answers`, asks new questions only (deduped), writes a new question file + extends `sourceQuestions`, appends next finish version (§11).

### Implementation notes (as built)

- **Stack:** Node.js + TypeScript (ESM), `commander` for the CLI, `inquirer` for prompts. Built with `tsc`.
- **Project init** — role in `~/.workgraph/config.json` per repo; full project context in `~/.workgraph/data/repos/<repo-id>/project.json`.
- **Author selection** is by email, persisted per repo in `~/.workgraph/config.json`.
- **Data layout** is namespaced per repository: `~/.workgraph/data/repos/<repo-id>/{project.json,commits/...,summaries/...,groups/...,reports/...,prepared/...}`. A **review period** (§0.5) nests the same sub-tree under `periods/<id>/`; all path helpers take an optional `period` argument.
- **Project context block** — role + `story.preparedContext` + `profile` injected into every LLM prompt in `summarize`, `commit-group`, and `report`.
- **Noise filter** and **area detection** are deterministic, shared library modules.
- **Model layer** is generated by a local Ollama model (chosen interactively, remembered) using `chatJson` structured JSON output with post-response extract/parse/schema validation (§13 Resilience); the signal-without-reason rule is enforced after generation.
- **Report provenance** — cumulative group files in root-level `sourceGroups`; per-entry provenance in `deterministic.historySource` parallel to `history` (same length, same indices); legacy formats are read for backward compatibility.
- `prepare` reads the latest report + `project.json`, runs four `narrativeModel` sessions (compose history, clean technologies, collapse reasons, reframe questionsAnalyses with **prior finish Q&A** resolved from finish archive + question files when present), writes `prepared/<reportId>.json` (no answers).
- `final` reads the latest `prepared/<reportId>.json` + `project.json`, writes question text to `finish/<finishId>.question.json` (or `.question.vN.json`), collects Q&A (four on first run; **extension mode** merges prior finish `answers` + up to four new questions), persists cumulative `answers[]` + `sourceQuestions` on the finish archive, runs three `narrativeModel` sessions (refine IMPACT — combined history in extension mode — then Role Narrative, then CV bullets over **all** Q&A), writes `RECONSTRUCTION.<project>.md` or `.vN.md` to **cwd**, and archives under `finish/<preparedId>.{md,json,question.json}` or `<preparedId>.vN.{md,json}` + `.question.vN.json` (`version` 1 or N+1).
- **`deepen`** reads the **latest** finish (highest `version`), follows `sourcePrepared` / `sourceReport`, collects **recalled non-code context**, generates four new questions (`narrativeModel`), writes `finish/<finishId>.question.vN.json`, collects four new answers, extends `sourceQuestions` and cumulative `answers[]`, refines IMPACT + Role Narrative + CV bullets over **combined history** (prepare baseline + prior final history) and **cumulative Q&A**, writes `RECONSTRUCTION.<project>.vN.md` to cwd, and appends `finish/<preparedId>.vN.{md,json}` without overwriting prior versions. Not part of `run`.
- **Token usage** — each LLM call logs prompt/output tokens to stderr; cumulative totals by step and model are stored in `project.json` → `tokenUsage`.
- `init`, `evidence`, `summarize`, and `commit-group` are **append-only** (`commit-group` uses **extension groups** on incremental re-run); `report` is **resumable**; `prepare` is **idempotent per report**; `final` reuses saved answers on the same prepared or **appends vN** in extension mode; `deepen` is **append-only per version** (skips when the next version file already exists).
- **`groupThresholdDays`** and **`groupMaxCommits`** (0 = unlimited) are persisted per repo in config; `commit-group` prompts for both on first run (`--days`, `--max-commits` skip the prompts).

⸻

## 14. Core principle

The system must preserve the distinction between evidence, interpretation, and missing context:

```
project story (raw)      = human-provided starting context (may be incomplete)
prepared story context   = role-adjusted interpretation of the story
project profile          = interpretation from README + story (may be wrong)
commits and patches      = evidence (deterministic, trustworthy)
deterministic JSON layer = evidence (files, churn, areas)
model summaries/signals  = interpretation (may be wrong, must cite reasons)
commit groups            = work sessions (deterministic membership + aggregated evidence)
group histories/signals  = interpretation over a session (may be wrong, must cite reasons)
groups.tiers + context   = signal-weighted membership (low de-emphasized in group history)
report                   = cumulative narrative (fold over sessions: merge, dedup, demote-only; history[i] ↔ deterministic.historySource[i])
prepared narrative       = role-aligned distillation of the final report (human deliverable)
questionsAnalyses        = reasoned open threads (observation + missingPiece + question); primary stored form at every stage
human-facing questions   = `question` strings derived in code (`flattenQuestions`) for `final` / `deepen` Q&A (up to 4 per round in prepared)
finish question files    = `<finishId>.question.json` / `.question.vN.json` — `{ id, question }[]` per round (not in prepared/)
schemaVersion            = encoded CLI package semver on every pipeline JSON artifact (§1.5)
human answers            = `{ questionId, answer }[]` on finish archive (cumulative); resolved via `sourceQuestions` + question files
sourceQuestions          = `{ "<finishId>": ["v1", "v2", …] }` on finish archive — which question rounds exist
role narrative           = four impact bullets (interpretation grounded in prepare output + answers)
cv bullets               = four impersonal resume lines (role-calibrated; no first person)
RECONSTRUCTION.<project>.md      = final personal artifact from `final` (cwd; v1)
RECONSTRUCTION.<project>.vN.md   = versioned artifact from `deepen` or extension `final` (append-only)
finish archive           = versioned JSON + md under finish/ (provenance chain; finish-chain `version` cursor + `schemaVersion`)
```

The system must **never overclaim impact, ownership, or production usage.** It reconstructs what happened and where, flags what may matter, asks what it cannot know, and lets the human confirm.
