# dev-workgraph MVP Requirements

## Goal

The MVP goal is to check whether dev-workgraph can **reconstruct forgotten engineering work from Git history and surface the right questions** to recover the human context that Git cannot store.

The MVP should answer the following questions:

1. Can we export commits and patches in a stable, reproducible format?
2. Can a **deterministic baseline** (no model) already reveal forgotten work and project areas?
3. Can a local model add useful, **non-overclaiming** commit-level descriptions on top of that baseline?
4. Can we group nearby commits into **work sessions** and produce a higher-level summary that respects per-commit signals?
5. Can grouped summaries **remind the user what they worked on and ask the right questions** to reconstruct missing context?

This MVP is **not** a resume generator, portfolio builder, achievement scorer, or interview assistant.
It is an evaluation prototype for one claim: *Git history can be reconstructed into a useful map of forgotten work, where the system reconstructs and asks, and the human confirms.*

### Core stance: reconstruct and ask, do not judge

Git history alone cannot tell us whether work shipped to production, whether it was the user's own design or maintenance of someone else's code, or whether it mattered to a customer. The MVP must **never claim impact**. Its job is to:

- reconstruct *what* changed and *where*,
- highlight *forgotten* or *high-activity* areas,
- and **ask the user** the questions that recover ownership, intent, and impact.

The questions are the primary product. Summaries and area context are supporting material.

⸻

## 0. Author selection (precondition for export)

Git history mixes the user's commits with teammates and bots (Renovate, Dependabot, Snyk). Before export, the user must declare which author **emails** are their own work, so only those commits are treated as evidence.

The system scans the repository (`git log --all --no-merges`), aggregates authors **by email** with commit counts, and lets the user select their identities. The selection is persisted per repository in `~/.workgraph/config.json`.

> Lesson from the first real run: near-identical emails (`vzaharchenko@…` vs `vzakharchenko@…`) are easy to confuse in a long list, and selecting the wrong one silently undercounts work. The author picker should surface large identities clearly and may group likely-same-person variants.

⸻

## 1. Commit and patch export

The system must be able to export commits from a Git repository. Only commits authored by the selected identities (§0) are exported.

For MVP, export can be manual or semi-automated.

Exported data is **namespaced per repository** so commits from different repos never mix. Each commit is stored in a folder named by its author Unix timestamp:

```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].patch
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
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
Export is **append-only**: existing commits are skipped, never overwritten unless explicitly forced.
The export should preserve:

* commit hash
* commit date (author date and commit date)
* author
* commit title/message
* changed files (with status: added/deleted/modified/renamed)
* patch content
* lines added / lines deleted per file

The patch export should exclude obvious noise where possible:
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
For MVP, noise filtering can be implemented either during patch export or during patch analysis, but the **set of excluded files must be recorded** so the report can disclose what was dropped.

⸻

## 2. Commit JSON summary

For every exported patch, the system creates a JSON file next to the patch:
```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
```

The JSON has **two layers**, kept clearly separated:

- **Deterministic layer** — computed without any model, always present. This is evidence. Written at export time.
- **Model layer** — added by a local model in a separate `summarize` step, optional, clearly marked as interpretation. Starts as `null`.

The model layer is produced by a **local model via Ollama** (HTTP API, default `http://127.0.0.1:11434`). The model is chosen interactively from the installed models and the choice is remembered. Generation uses Ollama structured output (a JSON Schema is passed so the response is schema-valid). Each generated layer records its provenance (model name, timestamp, whether the patch was truncated). Summarize is append-only: commits that already have a model layer are skipped unless forced.

### JSON schema

```json
{
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
  },

  "model": {
    "summary": "...",
    "changeTypes": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": {
      "technical": "...",
      "architecture": "...",
      "security": "..."
    },
    "questions": [],
    "confidence": "low | medium | high"
  }
}
```

#### Field meaning

**Deterministic layer (no model, always trustworthy):**

`changedFiles` — all files touched by the commit, by status.

`linesAdded` / `linesDeleted` — churn, computed from the patch.

`importantFolders` — folders touched by this commit (raw, derived from file paths).

`areas` — project areas this commit touches (see section 5 for how areas are defined).

`excludedFiles` — files dropped by noise filtering, so nothing is silently hidden.

**Model layer (interpretation, may be wrong):**

`summary` — plain-language explanation of what changed. Must describe the *change*, not its importance or impact.

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

`questions` — the questions a human must answer to recover missing context. **This is the most important model output.** See section 7.

`confidence` — the model's confidence in its own summary, `low | medium | high`.

#### Example

```json
{
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
    "questions": [
      "Was this used for real production deployment, or experimental?",
      "Did this replace a manual deployment process?",
      "Was this your own work or a shared team effort?"
    ],
    "confidence": "medium"
  }
}
```

⸻

## 3. Commit grouping (`commit-group`)

After export and per-commit summarize, the system groups commits into **work sessions** — bursts of activity separated by quiet periods. Each group gets its own JSON file with a **rebuilt deterministic layer** (aggregated from member commits) and a **new model layer** produced by **two local LLM sessions** (classify, then compose) that read the member commit JSONs and their signals.

This step replaces the earlier `build` (SQLite graph import) at the current MVP stage. Graph construction is deferred (see §10).

### Grouping threshold

Before grouping, the CLI asks how many **days** may pass between consecutive commits before starting a new group. The value is persisted per repository in `~/.workgraph/config.json`:

```json
{
  "repos": {
    "/absolute/path/to/repo": {
      "selectedAuthors": ["me@example.com"],
      "groupThresholdDays": 7
    }
  }
}
```

On later runs the saved value is offered as the default; the user may change it. A `--days <n>` flag skips the prompt.

### Grouping algorithm (deterministic)

1. Load all exported commit JSONs for the repository, **oldest first**.
2. Walk chronologically. Commits whose author timestamps are within `groupThresholdDays` of the **previous commit in the current group** belong to the same group.
3. When the gap exceeds the threshold, close the current group and start a new one.
4. A group with a single commit is valid.

Each group is written to:

```
~/.workgraph/data/repos/<repo-id>/groups/[unix-timestamp].json
```

`[unix-timestamp]` is the **author Unix timestamp of the last commit** in the group (seconds). Example:

```
~/.workgraph/data/repos/keycloak-radius-plugin-920018a3/groups/1717428123.json
```

Grouping is **append-only**: existing group files are skipped unless `--force` is passed.

### Group JSON schema

A group record mirrors the commit record shape (deterministic + model layers) but adds a `groups` block: all member commit hashes plus their **deterministic tier partition**.

```json
{
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
    }
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

`tiers` — a **deterministic** partition of the member hashes by signal tier. Every hash in `commits` appears in exactly one of `low` / `medium` / `hi`. This keeps the "which commit is high/medium/low" link as evidence, separate from the model's narrative context. Computed (not guessed) by these rules:

| Tier | Rule |
|------|------|
| `low` | All three per-commit signals (`technicalSignal`, `architectureSignal`, `securitySignal`) are `low`, **or** the commit has `model: null` |
| `hi` | At least one per-commit signal is `high` |
| `medium` | At least one signal is `medium` and none is `high` |

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

The group model layer is built in **two separate LLM sessions** per group via Ollama (same stack as `summarize`: structured JSON output, provenance, signal-without-reason enforcement). Splitting the work keeps each call focused and lets the summary be a faithful *merge* of the per-commit summaries rather than a fresh invention.

**Session 1 — classify** (`groupClassifyJsonSchema`, no `summary`):

* Input: the aggregated deterministic layer, a compact tier-annotated view of every member commit (title, areas, churn, signals, per-commit summary), and the deterministic `groups.tiers` partition as reference.
* Output: session-level `technicalSignal` / `architectureSignal` / `securitySignal` (each non-low with a reason), `changeTypes`, `questions`, `confidence`, and three arrays of **context bullets** — `hiContext`, `mediumContext`, `lowContext`. These are short phrases, **not** commit hashes. Commits close in meaning are **merged** into one bullet; unrelated ones are **added** as separate bullets.

**Session 2 — compose** (`groupComposeJsonSchema`, only `{ summary }`):

* Input: the session signals and context tiers from session 1, plus the member commits' per-commit summaries grouped by tier.
* Output: `summary` — a first-person, multi-paragraph **merge** of the commit summaries whose detail follows the tiers: **HIGH** work described in full (a paragraph or more per strand, naming real subsystems/areas), **MEDIUM** work described briefly, **LOW** work reduced to a single brief mention.

Both sessions follow the same rules: first-person voice (never "the team"/"they"/"we"), no overclaiming (never infer production usage, ownership, or impact — put unknowns into `questions`).

The final `model` object = session-1 fields (`changeTypes`, the three signals + `signalReasons`, `questions`, `confidence`, `hiContext`, `mediumContext`, `lowContext`) + session-2 `summary` + a `provenance` block the CLI attaches after generation.

Group summarize is append-only: groups that already have a `model` layer are skipped unless `--force`.

#### Example

```json
{
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
    "summary": "I built out deployment automation for the backend during this session. I added a deploy script and packaging so the service ships as a self-contained artifact, and adjusted the server entrypoint to match the new layout. Alongside that, I made a small fix to the docker-radius startup script.",
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
    "questions": [
      "Was the deployment work used in production or experimental?",
      "Was the docker-radius fix related to a reported issue, or incidental cleanup during the same session?"
    ],
    "confidence": "medium",
    "provenance": {
      "model": "qwen2.5-coder:14b",
      "generatedAt": "2026-06-13T15:00:00.000Z",
      "patchTruncated": false
    }
  }
}
```

⸻

## 4. Graph model (deferred)

SQLite graph import (`build`) and the node/edge model below are **out of scope for the current MVP stage**. They may follow once commit grouping proves useful.

<details>
<summary>Planned graph model (not implemented yet)</summary>

Required node types:
```
repository
commit
patch
commit-summary
file
folder-context
area-context
question
group-summary
```

Optional node types:
```
architecture-context
evidence-review
user-note
```

Required edge types:
```
COMMIT_HAS_PATCH
COMMIT_HAS_SUMMARY
COMMIT_TOUCHES_FILE
FILE_LOCATED_IN_FOLDER
FILE_PART_OF_AREA
FOLDER_PART_OF_REPOSITORY
SUMMARY_DERIVED_FROM_PATCH
SUMMARY_RAISES_QUESTION
SUMMARY_RELATES_TO_AREA
AREA_CONTEXT_UPDATED_BY_SUMMARY
GROUP_CONTAINS_COMMIT
GROUP_SUMMARY_DERIVED_FROM_COMMITS
SUPERSEDES
```

</details>

⸻

## 5. Project area detection and context

Areas are a separate context layer from individual commits. The purpose of area context is **not** to prove what a commit did. It is to explain *what part of the project was affected*, *what subsystem the files belong to*, and *what questions should be asked to confirm the area's rationale*.

### How an area is defined (MVP algorithm)

Area detection must be **deterministic and explainable** for the MVP — no model required:

1. **Rule:** an area is the **top-level project folder** of a changed file — the first path segment (e.g. `backend/server.js` → `backend`, `docs/x.png` → `docs`). Files at the repository root map to the `(root)` area.
2. This is intentionally simple and universal — no hardcoded container lists or per-project configuration.
3. Each file belongs to exactly one area; a commit's `areas` is the set of areas its non-noise files touch.

### Area context at group level (MVP)

For the current stage, area rollups are computed **deterministically from group JSON** when producing the report (§8): union of `deterministic.areas` across groups, commit counts and churn summed per area. Versioned area-context nodes in a graph are deferred (§4).

The model layer may then *describe* an area (what it seems to be for, what role it plays), but the **membership of files in areas is computed, not guessed**.

### Area context node (deferred)

When the graph is built later, each area will maintain a versioned area-context node holding:

* the area key (path)
* number of commits touching it
* total churn (lines added/deleted)
* first-seen and last-seen timestamps
* the model's optional description and architectural-role guess
* `questions` about why this area exists and what it is for

Area context evolves over time with `SUPERSEDES` rather than overwriting.

Area context is contextual information, **not** proof of user impact.

⸻

## 6. Commit-group session flow

Processing runs in chronological order, oldest group first.

For every group:

1. **Determine membership** — apply the day-threshold algorithm (§3) to exported commit JSONs.
2. **Write `groups.commits`** — ordered list of member commit hashes.
3. **Aggregate the deterministic layer** — merge `changedFiles`, churn, folders, areas, and `excludedFiles` from member commits (§3).
4. **Partition signal tiers** — compute the deterministic `groups.tiers` (`low` / `medium` / `hi`) from per-commit model signals.
5. **Session 1 — classify** — send the group deterministic layer, the tier-annotated member commits, and the `groups.tiers` reference to Ollama; get session signals + the three context-bullet arrays.
6. **Session 2 — compose** — send the classification + the per-commit summaries grouped by tier; get the merged first-person `summary`.
7. **Write the model layer** — assemble session-1 fields + session-2 `summary` + `provenance`.
8. **Persist** the group JSON to `~/.workgraph/data/repos/<repo-id>/groups/[timestampEnd].json`.

The deterministic layer, `groups.commits`, and `groups.tiers` must always be produced. The model layer is best-effort: if the local model is unavailable or fails on either session, the group is still saved with `model: null`, and the report counts it as "not summarized."

Per-commit data is never modified by `commit-group`; only group files are written.

⸻

## 7. Questions and missing context — the primary output

Git history cannot explain business context, ownership, or impact. The system's main value is generating the **questions a human must answer** to recover that context.

Questions may be attached to:

* commit summaries
* **group summaries** (primary at the current stage)
* folder-context nodes (deferred)
* area-context nodes (deferred)

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

The MVP must support **answering** questions (a `user-note` node linked to a question), because the loop "system asks → user answers → context is recovered" is the actual product. A question with no path to an answer is incomplete.

⸻

## 8. Usefulness report (`report`)

After export, summarize, and commit-group, the MVP produces a report. The report is built from **deterministic data first**; model-derived items are clearly labeled as interpretation.

The report must include:

1. Number of commits processed.
2. Number of commits with a model summary (and how many failed / were skipped).
3. Number of **groups** formed and how many have a group model summary.
4. Number of project areas detected (from commit and/or group deterministic layers).
5. Top areas by commit activity (deterministic).
6. Top areas by churn (deterministic).
7. Top areas by architecture/security signal (model, labeled as interpretation).
8. Most common generated questions (from group summaries first, then commits).
9. **Forgotten-work candidates** — areas with meaningful past activity that have not changed recently (deterministic; this is the "oh, I forgot I built that" signal).
10. Potential workstream candidates (areas or groups clustered by theme).
11. Disclosed limitations: how many files were excluded as noise, how many commits/groups had no model summary, how many commits were classified as `lowContext` within groups, where confidence is low.
12. Recommendation for the next development step.

Example output:

```
Processed commits: 300
Commit summaries (model): 287   (13 skipped: model unavailable)
Groups formed: 42
Group summaries (model): 40     (2 skipped: model unavailable)
Low-context commits (de-emphasized in groups): 118
Project areas detected: 18
Excluded as noise: 4,212 files

Top areas by activity:
- keycloak-plugins/Manufacturer-Plugin   (84 commits)
- backend                                 (61 commits)
- aws-delivery                            (39 commits)
- integration-tests                       (33 commits)

Forgotten-work candidates (active before, quiet since):
- email-verification        (last touched 14 months ago, 22 commits)
- device-onboarding         (last touched 11 months ago, 17 commits)

Potential workstreams (themes, unconfirmed):
- Identity and access platform work
- Manufacturer realm management
- Device and email verification
- AWS edge delivery automation
- Integration testing framework

Open questions to recover context (top):
- Was the AWS delivery work used in production?
- Was the Keycloak plugin your own design or maintenance?
- Did device verification ship to customers?

Limitations:
- Impact, ownership, and production usage are NOT inferred — confirm via questions.
- 13 commits unsummarized; 2 groups unsummarized; 4,212 files excluded as noise.
```

⸻

## 9. MVP success criteria

The MVP is successful if grouped summaries remind the user of forgotten work and ask questions that genuinely help recover missing context — from one real repository.

**Minimum success criteria:**

- 100+ commits can be exported and processed
- every commit has a deterministic layer; most have a model summary
- commits are grouped into work sessions using a configurable day threshold
- every group has an aggregated deterministic layer; most have a group model summary
- `groups.lowContext` / `mediumContext` / `hiContext` are populated consistently with per-commit signals
- project areas are detected deterministically
- useful questions are generated (especially at group level)
- top areas and forgotten-work candidates look meaningful to the user

**Strong success criteria:**

- group summaries reveal work the user had genuinely forgotten
- low-context commits are correctly de-emphasized without losing traceability
- model summaries are mostly accurate descriptions of the change (not of its importance)
- signal estimates with reasons match the user's own judgment of important subsystems
- answering the generated questions actually recovers ownership/intent/impact
- at least 5 plausible workstream candidates emerge for the user to confirm

**Failure criteria:**

- summaries are too generic to be useful
- area membership is mostly wrong
- grouping splits obvious work sessions or merges unrelated bursts
- the report reveals nothing the user didn't already know
- too much noise from generated files or folder structure
- the local model cannot summarize patches or groups reliably (in which case: the deterministic layer alone must still pass minimum criteria)

> Note: because the deterministic layer carries the minimum criteria, the MVP can succeed *even if the local model underperforms*. The model is an enhancement, not the foundation.

⸻

## 10. Out of scope for MVP

```
resume generation
PDF/DOCX export
public portfolio generation
numeric achievement scoring
multi-user support
cloud synchronization
full UI
advanced vector search
SQLite graph import (build)
complex graph database
automatic Jira/GitHub integration
production-ready plugin system
```
These may be added later if commit grouping and the report prove useful.

⸻

## 11. MVP implementation direction

Command flow (all commands take the repository path, for consistency):
```
dev-workgraph authors       ./repo   # scan history, select your author emails          [BUILT]
dev-workgraph export        ./repo   # export commits + patches + deterministic JSON   [BUILT]
dev-workgraph summarize     ./repo   # add per-commit model layer via local Ollama       [BUILT]
dev-workgraph commit-group  ./repo   # group commits by day threshold, 2 LLM sessions  [BUILT]
dev-workgraph report        ./repo   # usefulness analysis from commits + groups         [TODO]
dev-workgraph ask           ./repo   # review open questions, record answers             [TODO]
```

`authors`, `export`, and the deterministic part of `commit-group` must work **without any model**. `summarize` and the group model layer are additive.

### Implementation notes (as built)

- **Stack:** Node.js + TypeScript (ESM), `commander` for the CLI, `inquirer` for prompts. Built with `tsc`.
- **Author selection** is by email, persisted per repo in `~/.workgraph/config.json`.
- **Data layout** is namespaced per repository: `~/.workgraph/data/repos/<repo-id>/commits/...` and `.../groups/...`.
- **Noise filter** and **area detection** are deterministic, shared library modules.
- **Model layer** is generated by a local Ollama model (chosen interactively, remembered) using structured JSON output; the signal-without-reason rule is enforced after generation.
- `export`, `summarize`, and `commit-group` are **append-only** with a `--force` override.
- **`groupThresholdDays`** is persisted per repo in config; `commit-group` prompts for it on first run.

⸻

## 12. Core principle

The MVP must preserve the distinction between evidence, interpretation, and missing context:

```
commits and patches      = evidence (deterministic, trustworthy)
deterministic JSON layer = evidence (files, churn, areas)
model summaries/signals  = interpretation (may be wrong, must cite reasons)
commit groups            = work sessions (deterministic membership + aggregated evidence)
group summaries/signals  = interpretation over a session (may be wrong, must cite reasons)
groups.*Context tiers    = signal-weighted membership (low de-emphasized in group summary)
questions                = missing human context (the primary product)
user-notes               = recovered context (human answers)
graph (deferred)         = relationships between all of them
```

The system must **never overclaim impact, ownership, or production usage.** It reconstructs what happened and where, flags what may matter, asks what it cannot know, and lets the human confirm.

---

## Last change

Reason:

Reworked `commit-group` (§3, §6) to **two LLM sessions** per group. The `groups` block now holds `commits` plus a **deterministic** tier partition `tiers: { low, medium, hi }` (the commit→tier link stays as evidence; the model no longer re-partitions hashes). The model layer's `hiContext` / `mediumContext` / `lowContext` are now arrays of **context bullets** (not hashes), produced by **session 1 (classify)** along with signals/changeTypes/questions/confidence — merging commits that are close in meaning, adding unrelated ones separately. **Session 2 (compose)** then merges the per-commit summaries into a first-person, multi-paragraph `summary` whose detail follows the tiers (HIGH in full, MEDIUM briefly, LOW just mentioned). Voice switched to first person; area detection simplified to "top-level project folder" (§5). Prompts extracted to `src/lib/prompts.ts`.

Built so far: `authors`, `export`, `summarize`, `commit-group`. Next: `report`.

---

### Earlier change

Synced the spec with the implemented CLI. Added §0 "Author selection" (select your own work by email; persisted per repo) as a precondition, with the lesson about confusable near-identical emails. Switched the data layout to per-repository namespacing (`data/repos/<repo-id>/commits/...`) so repos never mix. Documented the model layer as a separate, append-only `summarize` step backed by a local Ollama model with structured JSON output and provenance. Rewrote §11 to the actual command flow, marking what is built vs TODO, and added implementation notes (TypeScript/commander/inquirer, deterministic noise + area modules, `--force` semantics).

Built so far at that point: `authors`, `export`, `summarize`.