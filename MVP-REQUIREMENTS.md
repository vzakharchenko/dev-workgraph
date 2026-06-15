# dev-workgraph MVP Requirements

## Goal

The MVP goal is to check whether dev-workgraph can **reconstruct forgotten engineering work from Git history and surface the right questions** to recover the human context that Git cannot store.

The MVP should answer the following questions:

0. Can we capture the developer's role and project backstory so later analysis is grounded in human context?
1. Can we export commits and patches in a stable, reproducible format?
2. Can a **deterministic baseline** (no model) already reveal forgotten work and project areas?
3. Can a local model add useful, **non-overclaiming** commit-level descriptions on top of that baseline?
4. Can we group nearby commits into **work sessions** and produce a higher-level summary that respects per-commit signals?
5. Can grouped summaries **remind the user what they worked on and ask the right questions** to reconstruct missing context?
6. Can a **prepared narrative** distill the full report into a role-aligned story with focused questions?
7. Can the human **answer the prepared questions** in `final` and produce a confirmed **role narrative** as `RESUME.<project>.md`?

This MVP is **not** a public resume generator, portfolio builder, achievement scorer, or interview assistant.
It is an evaluation prototype for one claim: *Git history can be reconstructed into a useful map of forgotten work, where the system reconstructs and asks, and the human confirms.* The final `RESUME.<project>.md` is a **personal reconstruction document** — grounded in Git evidence and human answers — not an auto-scored achievement claim.

### Core stance: reconstruct and ask, do not judge

Git history alone cannot tell us whether work shipped to production, whether it was the user's own design or maintenance of someone else's code, or whether it mattered to a customer. The MVP must **never claim impact**. Its job is to:

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

Both LLM sessions use Ollama. `init` is report-level work, so it uses the **`reportModel`** slot (see §14).

### On-disk layout

Raw story and prepared context are stored with the project profile under the repo data namespace:

```
~/.workgraph/data/repos/<repo-id>/project.json
```

Example:

```json
{
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

`init` is **idempotent**: if `project.json` already exists, skip unless `--force` (re-run both LLM sessions and overwrite).

### Project context in all later LLM calls

Every LLM session in `summarize`, `commit-group`, and `report` must receive a **project context block** prepended to the system or user prompt:

* **role** — from config;
* **preparedContext** — from `project.json` → `story.preparedContext`;
* **project profile** — from `project.json` → `profile` (`summary`, domains, stack, themes).

The model must use this context to:

* interpret patches and summaries in light of what the project is;
* avoid questions that README/story already answer;
* **frame `questions` according to role** (see §8).

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

## 1. Author selection (precondition for `evidence`)

Git history mixes the user's commits with teammates and bots (Renovate, Dependabot, Snyk). Before evidence extraction, the user must declare which author **emails** are their own work, so only those commits are treated as evidence.

The system scans the repository (`git log --all --no-merges`), aggregates authors **by email** with commit counts, and lets the user select their identities. The selection is persisted per repository in `~/.workgraph/config.json`.

> Lesson from the first real run: near-identical emails (`vzaharchenko@…` vs `vzakharchenko@…`) are easy to confuse in a long list, and selecting the wrong one silently undercounts work. The author picker should surface large identities clearly and may group likely-same-person variants.

⸻

## 2. Commit and patch evidence (`evidence`)

The system must be able to extract commit evidence from a Git repository. Only commits authored by the selected identities (§1) are extracted.

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

## 3. Commit JSON summary

For every exported patch, the system creates a JSON file next to the patch:
```
~/.workgraph/data/repos/<repo-id>/commits/[unix-timestamp]/[hash].json
```

The JSON has **two layers**, kept clearly separated:

- **Deterministic layer** — computed without any model, always present. This is evidence. Written at export time.
- **Model layer** — added by a local model in a separate `summarize` step, optional, clearly marked as interpretation. Starts as `null`.

The model layer is produced by a **local model via Ollama** (HTTP API, default `http://127.0.0.1:11434`). The model is chosen interactively from the installed models and the choice is remembered. Generation uses Ollama structured output (a JSON Schema is passed so the response is schema-valid). Each generated layer records its provenance (model name, timestamp, whether the patch was truncated). The **project context block** (§0) is included in every summarize prompt. Summarize is append-only: commits that already have a model layer are skipped unless forced.

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

`areas` — project areas this commit touches (see §6 for how areas are defined).

`excludedFiles` — files dropped by noise filtering, so nothing is silently hidden.

**Model layer (interpretation, may be wrong):**

`summary` — plain-language explanation of what changed. Must describe the *change*, not its importance or impact. **Routine upkeep is named, not detailed:** if the commit is only a dependency/version bump, lockfile, formatting, or CI change, say so plainly without naming versions; if it also has substantive work, describe **only** the substantive part. (Shared `ROUTINE_RULE`, applied at every stage.)

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

`questions` — the questions a human must answer to recover missing context. **This is the most important model output.** Framed according to developer role and project context (§0, §8). See §8.

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

## 4. Commit grouping (`commit-group`)

After export and per-commit summarize, the system groups commits into **work sessions** — bursts of activity separated by quiet periods. Each group gets its own JSON file with a **rebuilt deterministic layer** (aggregated from member commits) and a **new model layer** produced by **two local LLM sessions** (classify, then compose) that read the member commit JSONs and their signals.

This step replaces the earlier `build` (SQLite graph import) at the current MVP stage. Graph construction is deferred (see §13).

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

1. Load all exported commit JSONs for the repository, **oldest first**.
2. Walk chronologically. Commits whose author timestamps are within `groupThresholdDays` of the **previous commit in the current group** belong to the same group.
3. Close the current group and start a new one when **either** the gap exceeds the threshold **or** the current group has reached `groupMaxCommits` commits (when that cap is > 0).
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
* `areas` — union of per-commit areas (see §6).
* `excludedFiles` — union of per-commit excluded files.

This layer is evidence. It is written at group-creation time, before the LLM call.

#### Model layer (group interpretation) — two LLM sessions

The group model layer is built in **two separate LLM sessions** per group via Ollama (same stack as `summarize`: structured JSON output, provenance, signal-without-reason enforcement). Both sessions include the **project context block** (§0). Splitting the work keeps each call focused and lets the `history` be a faithful *merge* of the per-commit summaries rather than a fresh invention.

**Session 1 — classify** (`groupClassifyJsonSchema`, no `summary`):

* Input: the aggregated deterministic layer, a compact tier-annotated view of every member commit (title, areas, churn, signals, per-commit summary), and the deterministic `groups.tiers` partition as reference.
* Output: session-level `technicalSignal` / `architectureSignal` / `securitySignal` (each non-low with a reason), `changeTypes`, `questions`, `confidence`, and three arrays of **context bullets** — `hiContext`, `mediumContext`, `lowContext`. These are short phrases, **not** commit hashes. Commits close in meaning are **merged** into one bullet; unrelated ones are **added** as separate bullets.

**Session 2 — compose** (`groupComposeJsonSchema`, only `{ summary }`):

* Input: the session signals and context tiers from session 1, plus the member commits' per-commit summaries grouped by tier.
* Output: `history` — a first-person, multi-paragraph **merge** of the commit summaries (a fuller account, not a terse summary) whose detail follows the tiers: **HIGH is mandatory** — cover every item in full (a paragraph or more per strand, naming real subsystems/areas); **MEDIUM must be mentioned** — covered briefly, not dropped, but need not be exhaustive item-by-item; **LOW is optional** — at most a brief mention, may be omitted.

Both sessions follow the same rules: first-person voice (never "the team"/"they"/"we"), no overclaiming (never infer production usage, ownership, or impact — put unknowns into `questions`), questions framed according to role (§0), and the shared **routine rule** — routine upkeep (dependency/version bumps, build/CI/formatting) is kept to a single generic `lowContext` bullet (never in hi/medium); if the whole session is only routine the `history` is one short sentence stating that; if there is substantive work, only the substantive work is described.

The final `model` object = session-1 fields (`changeTypes`, the three signals + `signalReasons`, `questions`, `confidence`, `hiContext`, `mediumContext`, `lowContext`) + session-2 `history` + a `provenance` block the CLI attaches after generation.

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

## 5. Graph model (deferred)

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

## 6. Project area detection and context

Areas are a separate context layer from individual commits. The purpose of area context is **not** to prove what a commit did. It is to explain *what part of the project was affected*, *what subsystem the files belong to*, and *what questions should be asked to confirm the area's rationale*.

### How an area is defined (MVP algorithm)

Area detection must be **deterministic and explainable** for the MVP — no model required:

1. **Rule:** an area is the **top-level project folder** of a changed file — the first path segment (e.g. `backend/server.js` → `backend`, `docs/x.png` → `docs`). Files at the repository root map to the `(root)` area.
2. This is intentionally simple and universal — no hardcoded container lists or per-project configuration.
3. Each file belongs to exactly one area; a commit's `areas` is the set of areas its non-noise files touch.

### Area context at group level (MVP)

For the current stage, area rollups are computed **deterministically from group JSON** when producing the report (§9): union of `deterministic.areas` across groups, commit counts and churn summed per area. Versioned area-context nodes in a graph are deferred (§5).

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

## 7. Commit-group session flow

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

## 8. Questions and missing context — the primary output

Git history cannot explain business context, ownership, or impact. The system's main value is generating the **questions a human must answer** to recover that context.

Questions are **role-aware** (§0): the same patch may prompt a Principal Developer about org-wide rollout consequences and a Junior Developer about whether the task was assigned or self-initiated. Project profile and prepared story context prevent asking about facts the user already provided at `init`.

Questions may be attached to:

* commit summaries
* **group histories** (primary at the current stage)
* cumulative report (§9)
* **prepared narrative** (§10; sole input to `final`)
* **RESUME.<project>.md** (§11; final human-facing deliverable)
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

The MVP must support **answering** questions via the `final` command (§11), because the loop "system asks → user answers → context is recovered" is the actual product. A question with no path to an answer is incomplete.

⸻

## 9. Cumulative report (`report`)

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

Every intermediate report is written; the **final report** is the last in the chain. The chain is preserved so the accumulation is inspectable — and so the fold is **resumable**: a re-run loads the longest existing prefix of report files and continues from the next group (see §14).

### File layout

```
~/.workgraph/data/repos/<repo-id>/reports/<timestampEnd>.json
```

`<timestampEnd>` is the `timestampEnd` of the **latest group folded** into that report (so files sort chronologically and the highest-numbered file is the final report).

### Report JSON schema

```json
{
  "reportId": 1591444361,
  "sourceGroups": ["1579390000.json", "1591444361.json"],
  "groupCount": 2,

  "deterministic": {
    "changedFiles": { "added": [], "deleted": [], "modified": [], "renamed": [] },
    "linesAdded": 0,
    "linesDeleted": 0,
    "importantFolders": [],
    "areas": [],
    "excludedFiles": []
  },

  "model": {
    "changeTypes": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": { "technical": [], "architecture": [], "security": [] },
    "questions": [],
    "confidence": "low | medium | high",
    "hiContext": [],
    "mediumContext": [],
    "lowContext": [],
    "provenance": { "model": "...", "generatedAt": "..." }
  },

  "history": [
    { "text": "...", "sourceGroups": ["1579390000.json", "1591444361.json"] }
  ],

  "mergeCursor": 0
}
```

Differences from a group record:

* **No commit hashes.** Provenance is by group **file name**, not hashes — both at the report level (`sourceGroups`) and per history entry.
* **Signals stay single** `low/medium/high` (the **max** across folded groups), but **`signalReasons` are arrays** (the merged, deduped reasons from all folded groups).
* **`history`** (not "summary" — this is a fuller account of what was done) is a **bounded** running list (≤ `MAX_HISTORY_ENTRIES`) of objects `{ text, sourceGroups }`. Each entry carries its own `sourceGroups` — the group files that fed it (set at creation; unioned when compaction condenses entries). A new session's entry is added only when it contributes something not already there; when the list exceeds the cap, **exactly one adjacent pair** is merged via a **rolling cursor** (below).
* **`mergeCursor`** (optional, 0-based) — the rolling compaction pointer: the index of the first entry in the next pair to merge. It advances down the list each time compaction fires and wraps to the oldest, so compression is spread evenly across all ages instead of repeatedly re-squashing the oldest blob. Absent on legacy records ⇒ treated as `0`.

### `merge(report, group)`

**Routine gate (step 1 — one cheap LLM call).** A small classifier session decides whether the group is **ONLY routine upkeep** (dependency bumps, version/release updates, build-config/formatting/CI) versus **substantive** (design, implementation, real refactor, feature, bug fix, security). It reads the group's own `history` + signals + changeTypes (a small prompt) and returns `{ routine }`; when in doubt it answers `false`. A classifier (rather than a deterministic check) is used because per-commit/per-group labels alone don't reliably tell upkeep from real work. If **routine**, the group is folded **deterministically** (accumulate evidence + `sourceGroups`, union `changeTypes`, ensure the single generic maintenance bullet, leave `history` untouched) and the heavier sessions are skipped — so a routine group costs **one** small LLM call instead of three. Only **substantive** groups run the merge/add/compact sessions below.

**Deterministic (pure code):** union `changedFiles` / `importantFolders` / `areas` / `excludedFiles`, sum churn, append the group file name to `sourceGroups`.

**Signals (pure code):** each `*Signal` = `max(report, group)` on the `low < medium < high` scale.

**Model-merge — one LLM session.** Given the report's model and the group's model, produce:

* `changeTypes` — union; near-duplicate tags merged.
* `signalReasons.{technical,architecture,security}` — **arrays**, with duplicate / near-duplicate reasons collapsed.
* `questions` — recomputed for the combined body of work, deduped.
* `confidence` — re-assessed for the combined work.
* `hiContext` / `mediumContext` / `lowContext` — merge duplicate/similar bullets, then **re-rank importance DOWNWARD ONLY** (a minor `hi` bullet may be merged or demoted; nothing is ever promoted), and **bound each tier to ≤ `MAX_CONTEXT_BULLETS`** — when over, drop the least important, keeping the bullets **most relevant to the developer's role** (from the project context). A hard code-side slice backstops the cap.

**History — append + compaction** (bounded so the report scales to large repos). The `history` is a fuller account, not a terse summary; the tiers control **depth of detail**: **HIGH is mandatory** (in detail); **MEDIUM must be mentioned** (briefly); **LOW is optional**.

1. **Add only if new** (one LLM session): given the running history + current tiers + the new group's `history`, decide whether the new session adds anything not already captured. If yes, append `{ text, sourceGroups: [thisGroup] }`; if not, add nothing. The whole list is **not** rewritten each fold — that linear-rewrite was O(N²) and did not scale.
2. **Compaction — rolling merge cursor** (one LLM session, only when over the cap): when the list exceeds `MAX_HISTORY_ENTRIES`, merge **exactly the pair at `mergeCursor`** (that entry + its newer neighbour) into one role-prioritized entry, union their `sourceGroups`, then **advance the cursor** down the list (wrapping to the oldest after the last pair). The list returns to ≤ `MAX_HISTORY_ENTRIES`. Because each fold adds at most one entry, exactly one pair is merged per overflow. The pair is always taken from positions `0 … MAX_HISTORY_ENTRIES-2`, so the **newest entry is never merged** — it stays verbatim until the cursor reaches it on a later pass. This spreads compression evenly across all ages, so no single "oldest" blob is repeatedly re-summarized (which would degrade it through lossy re-paraphrasing). Example (cap = 4, cursor starts at `0`):

   ```
   [A, B, C, D]            cursor@0
   +E → [A+B, C, D, E]     cursor@1
   +F → [A+B, C+D, E, F]   cursor@2
   +G → [A+B, C+D, E+F, G] cursor@0 (wrapped)
   +H → [ABCD, E+F, G, H]  cursor@1
   ```

**Routine maintenance is collapsed, not enumerated.** All three report sessions (merge, add-if-new, compact) treat dependency bumps, version/release updates, lockfile/build-config tweaks, formatting, and CI upkeep as **one generic low-tier item** ("ongoing maintenance: dependency updates, version releases, build/CI upkeep") — the specific version or dependency does not matter. No per-release or per-bump entries; a routine-only session adds nothing when a maintenance mention already exists. This keeps upkeep distinct from substantive design/implementation work.

Because both contexts (≤ `MAX_CONTEXT_BULLETS`/tier) and history (≤ `MAX_HISTORY_ENTRIES`) are bounded, each fold's prompts are bounded — total cost is **O(N · cap)** rather than O(N²).

`init(group_1)` = `merge` against an empty report: signals / context tiers / `changeTypes` copied across, each `signalReasons` value lifted into a single-element array, `history` seeded with `{ text: group.history, sourceGroups: [group_1] }`.

### Voice & honesty

First person ('I'), never "the team" / "they" / "we". No overclaiming — production usage, ownership, and impact stay in `questions`. The report reconstructs and asks; it does not judge.

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

## 10. Prepared narrative (`prepare`)

After `report` produces the final cumulative report, `prepare` distills it into a **single role-aligned narrative** — the human-facing deliverable that answers "what did I do on this project, in terms that matter for my role?"

`prepare` reads the **latest report** (the report file with the highest `reportId` / `timestampEnd` in `reports/`), combines it with `project.json` (role + prepared story + profile), and writes a compact prepared record. All LLM sessions use the **`reportModel`** (§14).

### Inputs

1. **Latest report** — `~/.workgraph/data/repos/<repo-id>/reports/<reportId>.json` (the final fold in the chain).
2. **Project context** — `project.json` from `init` (§0): role, `story.preparedContext`, `profile`.

Precondition: both `project.json` and at least one report file must exist. If `prepare` was already run for this report, skip unless `--force`.

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

**Step 3 — Copy signals and change types (deterministic, no model).**

From the report's `model`, copy unchanged:

* `changeTypes`
* `technicalSignal`, `architectureSignal`, `securitySignal`

**Step 4 — Collapse signal reasons (one LLM session).**

Given the report's `signalReasons` arrays (`technical`, `architecture`, `security`), the **composed `history`** from step 2, and project context (role + story + profile), produce exactly **four** reason strings — a flat array that captures why the three signals are what they are, reframed for the role and the unified narrative. Near-duplicate reasons from the report arrays are merged; minor upkeep reasons are dropped.

**Step 5 — Reframe questions (one LLM session).**

Given the composed `history`, the four collapsed `signalReasons`, the report's existing `questions`, and project context (role + story + profile), produce exactly **four** new `questions` — role-aware prompts that help the human recover the missing context most relevant to their seniority (§8). Questions must target what Git still cannot know; do not repeat facts already in `project.json`.

**Step 6 — Console preview (deterministic, no model).**

After the prepared record is written, `prepare` prints a readable preview to the console: the **unified `history`** as one block, followed by the **four `questions`** (numbered). This makes the upcoming `final` step transparent — the user sees the reconstructed narrative and exactly which questions they will be asked before running `final`.

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
  "preparedId": 1759696393,
  "sourceReport": "1759696393.json",
  "groupCount": 65,

  "model": {
    "changeTypes": [],
    "technicalSignal": "low | medium | high",
    "architectureSignal": "low | medium | high",
    "securitySignal": "low | medium | high",
    "signalReasons": [],
    "questions": [],
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

* **`sourceReport`** — link to the report file by name (no commit hashes).
* **`changeTypes` / `*Signal`** — copied from the report (step 3).
* **`signalReasons`** — exactly **four** strings (step 4); not split by technical/architecture/security.
* **`questions`** — exactly **four** strings (step 5); role-aware.
* **`history`** — single unified narrative string (step 2); replaces the report's multi-entry `history` array.
* **`confidence`** — re-assessed in step 5 alongside questions, or copied from the report when unchanged.
* **No `deterministic` layer**, no `hiContext` / `mediumContext` / `lowContext`, no per-group provenance — the prepared record is interpretation for human review, grounded in the report + project context.

`prepare` is **idempotent per report**: if `prepared/<reportId>.json` exists, skip unless `--force`.

### Voice & honesty

Same rules as `report` (§9): first person ('I'), no overclaiming. The prepared narrative reconstructs and asks; it does not judge or score achievements.

⸻

## 11. Final deliverable (`final`)

The last pipeline step runs **only on the `prepare` result** (`prepared/<reportId>.json`, §10). It closes the loop: the system presents the four questions from the prepared record, the human answers them, and two `reportModel` LLM sessions produce the deliverable — first a **refined "Your IMPACT" narrative** that weaves the answers into the reconstructed history, then a **Role Narrative** of four impact bullet points framed for the selected role. Everything is written to a markdown file in the **current working directory** (where the CLI was launched), not under `~/.workgraph`.

`final` is **interactive** — it requires human input that cannot be gathered upfront (the questions only exist after `prepare`). It runs as the **last stage of `run`** (after `prepare`), and can also be run on its own.

### Inputs

1. **Latest prepared record** — `~/.workgraph/data/repos/<repo-id>/prepared/<reportId>.json` (output of `prepare`, §10). `final` does not read the report or groups directly — only `prepare` + `project.json`.
2. **Project context** — `project.json` (role, `story.preparedContext`, `profile`).

Precondition: `prepare` must have completed. If Q&A for this prepared record was already collected, offer to reuse it unless `--force`.

### Step 1 — Collect answers (interactive, no model)

Present each of the four `model.questions` from the prepared record one at a time (multi-line input allowed). Store as `{ question, answer }` pairs.

Answers are persisted alongside the prepared record:

```
~/.workgraph/data/repos/<repo-id>/prepared/<reportId>.json   # updated in-place with an `answers` block
```

```json
{
  "answers": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "answeredAt": "2026-06-14T12:00:00.000Z"
}
```

A `--answers-file <path>` flag may supply pre-written Q&A as JSON (non-interactive).

### Step 2a — Refine "Your IMPACT" with the answers (one LLM session, `reportModel`)

The prepared `model.history` is a reconstruction from Git evidence alone (§10). Now that the human has answered the open questions, refine it so the narrative reflects the **confirmed** ownership, intent, and context.

Given:

* `model.history` from the prepared record (the Git reconstruction);
* project context from `project.json` (role, `story.preparedContext`, `profile`);
* the four question–answer pairs from step 1.

Produce **one** refined first-person `history` string — the same flowing-prose form as the prepared history, with the answers woven in. Rules:

* use ONLY what the history shows or what the human stated in an answer — **invent nothing**;
* if an answer is empty or "I don't remember", keep the original reconstruction for that part;
* never overclaim production usage, customer impact, or org-wide adoption beyond what was stated;
* same **technical, claim-safe tone** as the Role Narrative below (no hype words, plain verbs, flowing prose — no Q/A formatting, no tier headers).

On model failure / empty output, fall back to the prepared `model.history` verbatim. This refined string is what fills the **`## Your IMPACT`** section, and it is the `history` fed into the Role Narrative below (so both sections stay consistent). It is written to the markdown only; the prepared record is not modified.

### Step 2b — Role Narrative (one LLM session, `reportModel`)

Given:

* the **refined `history`** from step 2a;
* project context from `project.json` (role, `story.preparedContext`, `profile`);
* `model.signalReasons` (the four collapsed reasons);
* the four question–answer pairs from step 1.

Produce exactly **four** impact bullet points — the **Role Narrative**. Each bullet describes the developer's impact on the project **as the selected role**, grounded in the history, signal reasons, and the human's own answers. Rules:

* first person ('I');
* describe *what was done and where* — never invent production usage, customer impact, or org-wide adoption unless the human stated it in an answer;
* frame emphasis according to role seniority (§0);
* **technical, claim-safe tone — not marketing:** write engineer-to-engineer, naming the actual components/protocols/mechanisms and design decisions; ban hype words (spearheaded, revolutionized, robust, seamless, leveraged, game-changing, etc.) and prefer plain verbs (implemented, added, refactored, designed, fixed, migrated);
* no numeric scores or superlatives ("best", "led the entire org").

### Step 3 — Write `RESUME.<project>.md` (deterministic assembly)

Write a markdown file to the **process current working directory** (`process.cwd()`, not the repo path):

```
RESUME.<project>.md
```

`<project>` is the repository **basename** (e.g. `keycloak-radius-plugin` → `RESUME.keycloak-radius-plugin.md`). A `--output <path>` flag overrides the filename.

#### File structure

```markdown
## PROJECT DESCRIPTION

{from project.json → profile.summary; optionally profile.domains / apparentStack as brief context}

## Your IMPACT as {ROLE}

{refined history from step 2a — the unified first-person narrative, with the human's answers woven in}

## Impact bullet points (Role Narrative)

- {role narrative bullet 1}
- {role narrative bullet 2}
- {role narrative bullet 3}
- {role narrative bullet 4}

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

The markdown file is the **MVP's final human-facing deliverable**. Re-running `final` with `--force` overwrites the file and updates the stored Q&A.

### Voice & honesty

The Role Narrative bullets are interpretation informed by human answers — they are **confirmed context**, not proof. If an answer is vague, the bullets must stay tentative ("I built X; production usage unconfirmed") rather than upgrading claims.

⸻

## 12. MVP success criteria

The MVP is successful if grouped summaries remind the user of forgotten work and ask questions that genuinely help recover missing context — from one real repository.

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
- `prepare` produces a readable unified history and four role-aligned questions from the final report
- `final` collects human responses to the prepared questions and writes `RESUME.<project>.md` with a four-bullet Role Narrative

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

> Note: because the deterministic layer carries the minimum criteria, the MVP can succeed *even if the local model underperforms*. The model is an enhancement, not the foundation.

⸻

## 13. Out of scope for MVP

```
public resume / portfolio generation
PDF/DOCX export
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
These may be added later. The personal `RESUME.<project>.md` from `final` is **in scope** — it is a confirmed reconstruction artifact, not a public portfolio.

⸻

## 14. MVP implementation direction

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
dev-workgraph final        ./repo   # prepared Q&A → Role Narrative → RESUME.<project>.md [BUILT]
dev-workgraph run          ./repo   # gather inputs upfront, run pipeline to prepare   [BUILT]
```

`init` should run once per repository before the first `summarize`. `authors`, `evidence`, and the deterministic part of `commit-group` work **without any model**. `init`, `summarize`, group model layers, `report`, `prepare`, and `final` (Role Narrative step) use the local LLM. **`final` runs at the END of `run`, after `prepare`** — it asks the four prepared questions interactively (they only exist after `prepare`), so it cannot be gathered upfront.

### `run` — unattended pipeline

`check` is a standalone preflight: it verifies the Ollama server is reachable and has at least one model, and otherwise prints OS-specific install help (macOS: `brew install ollama`; Linux: `curl -fsSL https://ollama.com/install.sh | sh`) plus `ollama pull` suggestions; it also flags any saved `commitModel`/`reportModel` that is no longer installed. `run` invokes the same check as a **preflight** and aborts before prompting if Ollama is not ready.

`run` is an orchestrator that **gathers every upfront input first** (after the Ollama preflight), then executes `init → evidence → summarize → commit-group → report → prepare` without further prompts, and finishes with **`final`** which asks the four prepared questions interactively. Upfront it asks only for what is missing (unless `--force` re-gathers all): the two models (below), developer role + project story (if `project.json` is absent), author identities (if none saved), and the group-threshold days (if not saved). Each unattended stage runs with those values passed as flags. Stages skip work that is already done (append-only / resume), so `run` is safe to re-run; on re-run `final` reuses saved answers unless `--force`. `final` can also be run on its own at any time.

### Two models (commit-level vs report-level)

The local model is chosen and remembered **per role**, in `~/.workgraph/config.json` under `ollama`:

- **`commitModel`** — used by `summarize` and `commit-group` (per-commit and per-session work).
- **`reportModel`** — used by `init`, `report`, `prepare`, and `final` (project-level / cumulative reasoning).

Each command seeds its picker from its own slot (falling back to a general `model`); `--model` forces a single model for that command. `run` asks for both upfront. This lets a fast model handle commit-level volume while a stronger model handles the higher-level report.

### Resilience

- **Retries:** every LLM call (`chatJson`) retries up to **3 attempts** with backoff on HTTP/transport/parse failure; after exhaustion the stage records the item as failed and the pipeline continues.
- **`report` resume:** each fold writes `reports/<timestampEnd>.json`, so a re-run (without `--force`) loads the longest existing prefix and **continues from the next group** instead of restarting. Adding new groups later extends the chain incrementally.

### Implementation notes (as built)

- **Stack:** Node.js + TypeScript (ESM), `commander` for the CLI, `inquirer` for prompts. Built with `tsc`.
- **Project init** — role in `~/.workgraph/config.json` per repo; full project context in `~/.workgraph/data/repos/<repo-id>/project.json`.
- **Author selection** is by email, persisted per repo in `~/.workgraph/config.json`.
- **Data layout** is namespaced per repository: `~/.workgraph/data/repos/<repo-id>/{project.json,commits/...,groups/...,reports/...,prepared/...}`.
- **Project context block** — role + `story.preparedContext` + `profile` injected into every LLM prompt in `summarize`, `commit-group`, and `report`.
- **Noise filter** and **area detection** are deterministic, shared library modules.
- **Model layer** is generated by a local Ollama model (chosen interactively, remembered) using structured JSON output; the signal-without-reason rule is enforced after generation.
- `prepare` reads the latest report + `project.json`, runs three `reportModel` sessions (compose history, collapse reasons, reframe questions), writes `prepared/<reportId>.json`.
- `final` reads the latest `prepared/<reportId>.json` + `project.json`, presents four prepared questions, persists Q&A to the prepared record, runs two `reportModel` sessions (refine the "Your IMPACT" narrative with the answers, then the four-bullet Role Narrative), writes `RESUME.<project>.md` to **cwd**.
- `init`, `evidence`, `summarize`, and `commit-group` are **append-only** with a `--force` override; `report` is **resumable**; `prepare` is **idempotent per report** (`--force` to regenerate); `final` overwrites `RESUME.<project>.md` on `--force`.
- **`groupThresholdDays`** and **`groupMaxCommits`** (0 = unlimited) are persisted per repo in config; `commit-group` prompts for both on first run (`--days`, `--max-commits` skip the prompts).

⸻

## 15. Core principle

The MVP must preserve the distinction between evidence, interpretation, and missing context:

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
report                   = cumulative narrative (fold over sessions: merge, dedup, demote-only)
prepared narrative       = role-aligned distillation of the final report (human deliverable)
questions                = missing human context (the primary product; role-aware; 4 in prepared)
human answers            = recovered context (confirmed by the user in `final`)
role narrative           = four impact bullets (interpretation grounded in prepare output + answers)
RESUME.<project>.md      = final personal artifact from `final` (cwd; not auto-scored, not public portfolio)
graph (deferred)         = relationships between all of them
```

The system must **never overclaim impact, ownership, or production usage.** It reconstructs what happened and where, flags what may matter, asks what it cannot know, and lets the human confirm.

---

## Last change

Reason:

Two changes. **(1)** `report` history compaction (§9) now uses a **rolling merge cursor** (`mergeCursor` on the report record): on overflow it merges exactly the adjacent pair at the cursor, then advances the cursor down the list and wraps — so compression is spread evenly across all ages instead of repeatedly re-squashing the oldest blob (which degraded the oldest history through lossy re-paraphrasing). The newest entry is never merged. **(2)** `final` now **refines the "Your IMPACT" narrative with the human's answers** (§11, new Step 2a): a `reportModel` session weaves the Q&A into the Git-reconstructed history (invent-nothing; empty answer ⇒ keep reconstruction; claim-safe tone), and the Role Narrative bullets (Step 2b) are built from that refined history so both sections stay consistent. Falls back to the prepared history on model failure; written to markdown only (the prepared record is unchanged).

---

### Change history #1

Renamed the **`export`** command to **`evidence`** (§2): `dev-workgraph evidence` extracts each commit's patch + deterministic evidence layer. The name matches the spec's "deterministic baseline / evidence" terminology. Renamed `export.ts` → `evidence.ts`, `exportCommits()` → `evidence()`, `ExportOptions` → `EvidenceOptions`; updated the `run` pipeline stage (`[2/7] evidence`) and all command-flow references. Historical change-log entries below keep the old `export` name.

---

### Change history #2

`prepare` now prints a **console preview** after writing its record (§10, Step 6): the unified `history` as one block, then the four numbered `questions`. This makes the upcoming `final` step transparent — the user sees the reconstructed narrative and exactly which questions they will be asked before running `final`.

---

### Change history #3

Added a **`check`** command (§14): verifies the Ollama server is reachable and has ≥1 model, else prints OS-specific install help (macOS `brew install ollama`, Linux `curl … install.sh`) + `ollama pull` suggestions, and flags saved `commitModel`/`reportModel` no longer installed. The reusable `ollamaReady()` runs as a **preflight in `run`** (aborts before prompting if Ollama isn't ready). Removed the keycloak/RAD-SEC examples from the prompts (now domain-neutral). Suggested-pull models: `qwen2.5-coder:14b`, `gpt-oss:latest`.

---

### Change history #4

Tuned the `final` Role Narrative prompt (§11) for a **technical, claim-safe tone**: write engineer-to-engineer with concrete components/protocols/mechanisms, ban marketing/hype words (spearheaded, robust, seamless, leveraged, …), prefer plain verbs (implemented, added, refactored, fixed). No behavior change elsewhere.

---

### Change history #5

Added a second grouping bound to `commit-group` (§3): **`groupMaxCommits`** (0 = unlimited) caps commits per work-session group, so a new group also starts when the current one reaches the cap — not only on the day-gap. Persisted per repo; prompted on first run (`--max-commits` skips). `run` gathers it upfront alongside the day threshold. Default 20.

---

### Change history #6

Built **`prepare`** (§10) and **`final`** (§11).

- **`prepare`** reads the latest report + `project.json` and runs three `reportModel` sessions — (1) compose one unified first-person `history`, (2) collapse `signalReasons` to **four**, (3) reframe **four** role-aware questions (+ confidence). Signals and `changeTypes` are copied from the report. Writes `data/repos/<repo-id>/prepared/<reportId>.json`; idempotent per report (`--force`). Added to `run` as the final unattended stage.
- **`final`** (interactive, not in `run`) reads the latest `prepared/<reportId>.json` + `project.json`, collects answers to the four questions (interactive editor, or `--answers-file`), persists `{answers, answeredAt}` in-place, runs one `reportModel` session for a four-bullet **Role Narrative**, and writes **`RESUME.<project>.md`** to the cwd (`--output` overrides). `--force` re-answers/overwrites.

Both commands done. `run` now executes the full pipeline `init → export → summarize → commit-group → report → prepare → final` (the unattended stages first, then `final` asks the prepared questions interactively at the end). `final` can still be run on its own.

Next: `ask` (deferred), polish.

---

### Change history #7

Added **`answers`** (now **`final`**, §11) as the final pipeline step. Interactive: presents the four prepared questions, persists Q&A to `prepared/<reportId>.json`, runs one `reportModel` session to produce a **Role Narrative** (exactly four impact bullets from `history` + project context + `signalReasons` + answers). Writes **`RESUME.<project>.md`** to **cwd**. Not part of `run`. Updated Goal (Q7), success criteria, out of scope, command flow, core principle.

---

### Change history #8

Added **`prepare`** (§10): reads the **latest report**, concatenates `history[]` entries (newline-separated), then three `reportModel` LLM sessions — (1) compose a single role-aligned `history` using `project.json` context, (2) collapse `signalReasons` into exactly **four** bullets, (3) reframe exactly **four** role-aware `questions`. Signals and `changeTypes` are copied from the report unchanged. Output: `data/repos/<repo-id>/prepared/<reportId>.json`. Updated Goal (question 6), §8, §11 success criteria, §13 command flow (`prepare` after `report`, `run` includes `prepare`), §14 core principle. Renumbered §10–§13 → §11–§14.

---

### Change history #9

Pushed the **routine rule** upstream to `summarize` (§2) and `commit-group` (§3): a shared `ROUTINE_RULE` now governs every stage — routine upkeep (dependency/version bumps, build/CI/formatting) is **named, not detailed** (no versions, no per-bump list); if work is only routine, say so plainly; if there is substantive work, describe **only** the substantive part. At group level routine stays a single generic `lowContext` bullet (never hi/medium), and a routine-only session's `history` is one short sentence. The report's collapse rule now builds on this shared rule.

---

### Change history #10

Added a **routine gate** to `report` (§8, step 1): a small LLM classifier decides routine-upkeep vs substantive; routine groups are folded **deterministically** (evidence accumulates, one generic maintenance bullet, history untouched) so they cost one cheap LLM call instead of three, while only substantive groups run the merge/add/compact sessions. Added a **routine-maintenance collapse** rule to all three report sessions: upkeep is folded into one generic low-tier item instead of per-release/per-bump entries. `report` now prints **per-fold sub-steps** (`[1/4] check`, `[2/4] merge`, `[3/4] add-if-new`, `[4/4] compact`) so it's clear which LLM session is running.

Made `report` **scalable** (§8). The linear fold was O(N²) — every fold re-read and rewrote the entire growing `history` and re-fed ever-growing context tiers, which choked the model on large repos (huge prompts → `fetch failed`). Now both are **bounded**: context tiers are capped at `MAX_CONTEXT_BULLETS` per tier (keeping the bullets most relevant to the developer's role, demote-only), and `history` is capped at `MAX_HISTORY_ENTRIES` — the per-fold rewrite-all was removed (just append-if-new), and when the list overflows, the oldest entries are **compacted** into one role-prioritized entry (provenance unioned). Cost is now O(N · cap). `report` resume and the two-model split are unchanged.

---

### Change history #11

Built **`init`** and the **`run`** orchestrator, plus resilience and a two-model split (§12):

- **`init`** (§0) implemented: role + project story → two LLM sessions (prepared context, project profile) → `project.json`; project-context block injected into every later LLM prompt.
- **`run`** — gathers all inputs upfront (two models, role+story, authors, group days), then runs `init → export → summarize → commit-group → report` unattended; only asks for what is missing unless `--force`.
- **Two models:** `commitModel` (`summarize`, `commit-group`) and `reportModel` (`init`, `report`), remembered separately under `ollama` in config; each command seeds from its slot, `--model` overrides.
- **Retries:** `chatJson` retries up to 3 attempts with backoff on HTTP/parse failure.
- **`report` resume:** re-runs continue from the longest existing report-file prefix instead of restarting.

Built so far: `init`, `authors`, `export`, `summarize`, `commit-group`, `report`, `run`. Next: `ask`.

---

### Change history #12

Renamed the group model's prose field from `summary` to **`history`** (§4, §7): `commit-group`'s second session now produces a fuller first-person `history` (covering BOTH high- and medium-tier work; low only mentioned/omitted), and `report` folds each group's `history` (not a summary) into the cumulative report history. The per-commit `summary` (§3) is unchanged. Strengthened both the group-compose and report-history prompts so the tiers control DEPTH, not inclusion — medium work must never be dropped.

---

### Change history #13

Redefined `report` (§8) as a **cumulative fold over groups**: `report_k = merge(report_{k-1}, group_k)`, every intermediate report kept under `data/repos/<repo-id>/reports/<timestampEnd>.json`. A report links source groups by **file name** (no commit hashes); `deterministic` is unioned; `*Signal` is the **max** across groups while `signalReasons` become **arrays**; `changeTypes`/`questions`/`confidence` and the `hiContext`/`mediumContext`/`lowContext` tiers are recomputed in one LLM merge session that dedups similar bullets and **re-ranks importance downward only** (never promotes). `history` (renamed from "summary" — it is a fuller account, not a terse summary, with the tiers controlling depth: HIGH detailed, MEDIUM lighter, LOW at most a brief mention or omitted) is a running list of `{ text, sourceGroups }` entries: on each fold, the whole list is re-read and rewritten **1:1** to the new contexts in **one** session (so per-entry provenance accumulates by group file name), then a second session appends a new entry only if the incoming session adds something not already covered. Cost is intentionally not optimized (maximize local-LLM use). `report` is **[BUILT]**. §11 and §12 updated.

---

### Change history #14

Reworked `commit-group` (§3, §6) to **two LLM sessions** per group. The `groups` block now holds `commits` plus a **deterministic** tier partition `tiers: { low, medium, hi }` (the commit→tier link stays as evidence; the model no longer re-partitions hashes). The model layer's `hiContext` / `mediumContext` / `lowContext` are now arrays of **context bullets** (not hashes), produced by **session 1 (classify)** along with signals/changeTypes/questions/confidence — merging commits that are close in meaning, adding unrelated ones separately. **Session 2 (compose)** then merges the per-commit summaries into a first-person, multi-paragraph `summary` whose detail follows the tiers (HIGH in full, MEDIUM briefly, LOW just mentioned). Voice switched to first person; area detection simplified to "top-level project folder" (§5). Prompts extracted to `src/lib/prompts.ts`.

Built so far: `authors`, `export`, `summarize`, `commit-group`. Next: `report`.

---

### Change history #15

Synced the spec with the implemented CLI. Added §0 "Author selection" (select your own work by email; persisted per repo) as a precondition, with the lesson about confusable near-identical emails. Switched the data layout to per-repository namespacing (`data/repos/<repo-id>/commits/...`) so repos never mix. Documented the model layer as a separate, append-only `summarize` step backed by a local Ollama model with structured JSON output and provenance. Rewrote §11 to the actual command flow, marking what is built vs TODO, and added implementation notes (TypeScript/commander/inquirer, deterministic noise + area modules, `--force` semantics).

Built so far at that point: `authors`, `export`, `summarize`.
