# dev-workgraph MVP Requirements

## Goal

The MVP goal is to check whether dev-workgraph can **reconstruct forgotten engineering work from Git history and surface the right questions** to recover the human context that Git cannot store.

The MVP should answer the following questions:

1. Can we export commits and patches in a stable, reproducible format?
2. Can a **deterministic baseline** (no model) already reveal forgotten work and project areas?
3. Can a local model add useful, **non-overclaiming** commit-level descriptions on top of that baseline?
4. Can we build an immutable graph from commits, patches, summaries, files, and project areas?
5. Can the resulting graph **remind the user what they worked on and ask the right questions** to reconstruct missing context?

This MVP is **not** a resume generator, portfolio builder, achievement scorer, or interview assistant.
It is an evaluation prototype for one claim: *Git history can be reconstructed into a useful map of forgotten work, where the system reconstructs and asks, and the human confirms.*

### Core stance: reconstruct and ask, do not judge

Git history alone cannot tell us whether work shipped to production, whether it was the user's own design or maintenance of someone else's code, or whether it mattered to a customer. The MVP must **never claim impact**. Its job is to:

- reconstruct *what* changed and *where*,
- highlight *forgotten* or *high-activity* areas,
- and **ask the user** the questions that recover ownership, intent, and impact.

The questions are the primary product. Summaries and area context are supporting material.

⸻

## 1. Commit and patch export

The system must be able to export commits from a Git repository.

For MVP, export can be manual or semi-automated.

Each exported commit must be stored in a folder named by commit Unix timestamp:

```
~/.workgraph/data/commits/[unix-timestamp]/[hash].patch
~/.workgraph/data/commits/[unix-timestamp]/[hash].json
```
Example:
```
~/.workgraph/data/commits/1717428123/b0648088.patch
~/.workgraph/data/commits/1717428123/b0648088.json
```

The patch must be generated from Git using a reproducible command.

Suggested command:
```
git show --format=fuller --find-renames <commit-hash> > ~/.workgraph/data/commits/<unix-timestamp>/<commit-hash>.patch
```
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
~/.workgraph/data/commits/[unix-timestamp]/[hash].json
```

The JSON has **two layers**, kept clearly separated:

- **Deterministic layer** — computed without any model, always present. This is evidence.
- **Model layer** — added by a local model, optional, clearly marked as interpretation.

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

## 3. Import data into database and build graph

The system must import exported commit data into a database. For MVP, SQLite is enough.

A minimal schema is sufficient:
```
nodes(id, type, key, version, data_json)
edges(id, src_id, dst_id, type)
```

The system creates graph nodes and edges from:

* commits
* patches
* commit summaries
* changed files
* project folders / project areas
* generated context nodes
* questions

The graph must be **append-only**. Existing summaries and area context must not be overwritten. New analysis creates new nodes or new versions linked with `SUPERSEDES`.

⸻

## 4. MVP graph model

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
```
Optional node types:
```
group-summary
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
SUPERSEDES
```

⸻

## 5. Project area detection and context

Areas are a separate context layer from individual commits. The purpose of area context is **not** to prove what a commit did. It is to explain *what part of the project was affected*, *what subsystem the files belong to*, and *what questions should be asked to confirm the area's rationale*.

### How an area is defined (MVP algorithm)

Area detection must be **deterministic and explainable** for the MVP — no model required:

1. **Primary rule:** an area is the top-level (or second-level for monorepos) directory of a changed file, e.g. `backend/`, `keycloak-plugins/Manufacturer-Plugin/`. The depth is configurable; default is the first path segment, or two segments when the first is a known container like `packages/`, `plugins/`, `services/`, `apps/`, `keycloak-plugins/`.
2. **Co-change signal (optional, still deterministic):** folders that are frequently changed together across commits may be grouped into one area. This catches subsystems that span directories.
3. Each file is assigned to exactly one area via `FILE_PART_OF_AREA`.

The model layer may then *describe* an area (what it seems to be for, what role it plays), but the **membership of files in areas is computed, not guessed**.

### Area context node

For each area the system maintains an area-context node holding:

* the area key (path)
* number of commits touching it
* total churn (lines added/deleted)
* first-seen and last-seen timestamps
* the model's optional description and architectural-role guess
* `questions` about why this area exists and what it is for

Area context evolves over time: when a new commit affects an existing area, the system creates a **new version** and links it with `SUPERSEDES` rather than overwriting:
```
area-context:keycloak-plugins:v1
area-context:keycloak-plugins:v2
area-context:keycloak-plugins:v2 --SUPERSEDES--> area-context:keycloak-plugins:v1
```

Area context is contextual information, **not** proof of user impact.

⸻

## 6. Incremental graph construction

The graph is built incrementally in chronological order, oldest commit first.

For every commit:

1. Read patch.
2. Compute the **deterministic layer** (changed files, churn, folders, areas, excluded files).
3. Read or generate the **model layer** (summary, change types, signals + reasons, questions).
4. Create commit node.
5. Create patch node.
6. Create commit-summary node.
7. Create file nodes if missing.
8. Create or update folder-context nodes.
9. Create or update area-context nodes (new version + `SUPERSEDES` when the area already exists).
10. Create question nodes and edges.
11. Create edges between all related nodes.

The deterministic layer must always be produced. The model layer is best-effort: if the local model is unavailable or fails on a patch, the commit is still imported with deterministic data and a `model: null` marker, and the report counts it as "not summarized."

⸻

## 7. Questions and missing context — the primary output

Git history cannot explain business context, ownership, or impact. The system's main value is generating the **questions a human must answer** to recover that context.

Questions may be attached to:

* commit summaries
* folder-context nodes
* area-context nodes
* future group summaries

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

## 8. Graph usefulness analysis

After importing and processing, the MVP produces a report. The report is built from **deterministic data first**; model-derived items are clearly labeled as interpretation.

The report must include:

1. Number of commits processed.
2. Number of commits with a model summary (and how many failed / were skipped).
3. Number of project areas detected.
4. Top areas by commit activity (deterministic).
5. Top areas by churn (deterministic).
6. Top areas by architecture/security signal (model, labeled as interpretation).
7. Most common generated questions.
8. **Forgotten-work candidates** — areas with meaningful past activity that have not changed recently (deterministic; this is the "oh, I forgot I built that" signal).
9. Potential workstream candidates (areas grouped by theme).
10. Disclosed limitations: how many files were excluded as noise, how many commits had no model summary, where confidence is low.
11. Recommendation for the next development step.

Example output:

```
Processed commits: 300
Commit summaries (model): 287   (13 skipped: model unavailable)
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
- 13 commits unsummarized; 4,212 files excluded as noise.
```

⸻

## 9. MVP success criteria

The MVP is successful if the resulting graph reminds the user of forgotten work and asks questions that genuinely help recover missing context — from one real repository.

**Minimum success criteria:**

- 100+ commits can be exported and processed
- every commit has a deterministic layer; most have a model summary
- graph nodes and edges are created successfully
- project areas are detected deterministically
- area context evolves over time (versioned with `SUPERSEDES`)
- useful questions are generated
- top areas and forgotten-work candidates look meaningful to the user

**Strong success criteria:**

- the graph reveals work the user had genuinely forgotten
- model summaries are mostly accurate descriptions of the change (not of its importance)
- signal estimates with reasons match the user's own judgment of important subsystems
- answering the generated questions actually recovers ownership/intent/impact
- at least 5 plausible workstream candidates emerge for the user to confirm

**Failure criteria:**

- summaries are too generic to be useful
- area membership is mostly wrong
- the graph reveals nothing the user didn't already know
- too much noise from generated files or folder structure
- the local model cannot summarize patches reliably (in which case: the deterministic layer alone must still pass minimum criteria)

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
complex graph database
automatic Jira/GitHub integration
production-ready plugin system
```
These may be added later if the graph proves useful.

⸻

## 11. MVP implementation direction

Suggested MVP command flow:
```
dev-workgraph export ./repo          # export commits + patches + deterministic JSON
dev-workgraph summarize ~/.workgraph/data/commits   # add model layer (best-effort)
dev-workgraph build                  # import into SQLite, build graph
dev-workgraph report                 # usefulness analysis
dev-workgraph ask                    # review open questions, record answers as user-notes
```

`export` and `build` must work **without any model**. `summarize` and the model layer are additive.

⸻

## 12. Core principle

The MVP must preserve the distinction between evidence, interpretation, and missing context:

```
commits and patches      = evidence (deterministic, trustworthy)
deterministic JSON layer = evidence (files, churn, areas)
model summaries/signals  = interpretation (may be wrong, must cite reasons)
folder and area context  = architectural explanation (contextual, not proof)
questions                = missing human context (the primary product)
user-notes               = recovered context (human answers)
graph                    = relationships between all of them
```

The system must **never overclaim impact, ownership, or production usage.** It reconstructs what happened and where, flags what may matter, asks what it cannot know, and lets the human confirm.

---

## Last change

Reason:

Reframed the MVP from "score achievements" to "reconstruct forgotten work and ask the right questions." Split commit JSON into a deterministic layer (always present, trustworthy) and a model layer (additive, interpretation). Replaced numeric signals with `low/medium/high` plus required evidence-based reasons to kill false precision. Defined a concrete, model-free area-detection algorithm. Made questions and their answers (user-notes) a first-class loop. Ensured the MVP can succeed on the deterministic layer alone even if the local model underperforms.