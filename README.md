# dev-workgraph

**Turn a Git repository into a career story you can defend** — for a performance review, a CV, or interview prep.

You point the CLI at a repo where you actually worked. It reads your commits and patches, asks what Git cannot know, you confirm the missing context, and it writes **`RECONSTRUCTION.<project>.md`**: what you did, where in the system, and what impact means for **your role** (Principal, Staff, Senior, Junior) — with role narrative bullets and CV bullets grounded in evidence, not a blank ChatGPT prompt.

## Why this exists

**The problem.** Every few months you must explain your work: to your manager, on a review form, on a resume, to a recruiter, to an ATS. You were busy — but memory fades. Git remembers *diffs*; it does not remember *why*, *whether it shipped*, *who owned the design*, or *how it maps to impact*. Generic AI can polish prose, but it invents or drifts because it never saw your repo or your answers.

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

See real outputs in [`examples/`](./examples/) — e.g. a [~300-commit Forge app](examples/Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) (Principal Developer) and [this CLI](examples/dev-workgraph/RECONSTRUCTION.dev-workgraph.v2.md) (Staff Developer).

## Quick start

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

Example outputs: [`examples/Forge-Secure-Notes-for-Jira/`](./examples/Forge-Secure-Notes-for-Jira/) · [`examples/dev-workgraph/`](./examples/dev-workgraph/).

See **[`dev-workgraph-cli/README.md`](./dev-workgraph-cli/README.md)** for commands, data layout, and development.

## How it runs

**Local only** — [Ollama](https://ollama.com) on your machine. No cloud API; analysis stays under `~/.workgraph/` unless you `export` a bundle yourself.

**Resumable** — stop anytime before `final`; re-run `dev-workgraph run .` and completed commits, groups, and report folds are skipped. Interactive Q&A starts only after `prepare`.

**Dogfooded** on **MacBook Pro M4 Pro (48 GB)**. One real repo (**~300 commits**): unattended stages took **~6 hours** before the first questions (`final`). Time depends on models, patch size, and cache from prior runs.

### Recommended Ollama models

Use strong models for real runs — weak ones work for smoke tests but hurt long reports.

| Slot | Model | Used for |
|------|--------|----------|
| `commitModel` | `qwen2.5-coder:14b` | `summarize`, `commit-group` |
| `reportModel` | `gpt-oss:latest` | `report` |
| `narrativeModel` | `gemma4:31b` | `init`, `prepare`, `final`, `deepen` |

`run` saves the three slots in `~/.workgraph/config.json`.

## Repository layout

| Path | Description |
|------|-------------|
| [`dev-workgraph-cli/`](./dev-workgraph-cli/) | Node.js CLI — install, usage, examples |
| [`examples/`](./examples/) | Sample `RECONSTRUCTION.*.md` outputs — see [`examples/README.md`](./examples/README.md) |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Architecture overview + diagrams from `img/` |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | Full product & pipeline specification |
| [`uml/`](./uml/) | Pipeline diagrams (PlantUML, Graphviz) — PNG: `./scripts/generatePNGFromSchemas.sh` → [`img/`](./img/) |
