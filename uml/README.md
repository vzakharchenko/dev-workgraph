# Pipeline diagrams

PlantUML (`.puml`) and Graphviz (`.dot`) sources for dev-workgraph architecture visuals.

## Regenerate PNGs

From the repository root:

```bash
./scripts/generatePNGFromSchemas.sh
```

**Requires:** [PlantUML](https://plantuml.com/) (`plantuml`) and [Graphviz](https://graphviz.org/) (`dot`).

Output lands in [`../img/`](../img/). [`ARCHITECTURE.md`](../ARCHITECTURE.md) lists which source maps to which PNG.

## LLM backends in diagrams

Model stages **(M:c)**, **(M:r)**, and **(M:n)** use a **local LLM backend** — [Ollama](https://ollama.com) and/or [LM Studio](https://lmstudio.ai):

| Slot | Stage group | Default URLs |
|------|-------------|--------------|
| **commitModel** (M:c) | `summarize`, `commit-group` | Ollama `:11434`, LM Studio `:1234` |
| **reportModel** (M:r) | `report` | same |
| **narrativeModel** (M:n) | `init`, `prepare`, `final`, `deepen` | same |

`check` and `run` discover both backends. Each saved slot stores `{ provider, baseUrl, model }` in `~/.workgraph/config.json` under `llm`. LM Studio steps unload/load models between pipeline stages.

See [`REQUIREMENTS.md`](../REQUIREMENTS.md) §13 and [`dev-workgraph-cli/README.md`](../dev-workgraph-cli/README.md) for CLI flags (`--ollama-url`, `--lmstudio-url`).

## Files

| Source | Topics |
|--------|--------|
| `pipeline.puml` | End-to-end pipeline, data layout, deepen, run orchestrator |
| `pipeline-graph.dot` | Work-graph vertex/edge overview |
| `preconditions.puml` | `check`, `authors`, `init`, project context |
| `evidence.puml` | Deterministic evidence extraction |
| `summarize.puml` | Per-commit model layer |
| `commit-group.puml` | Work sessions |
| `report.puml` | Cumulative report fold |
| `prepare.puml` | Prepared narrative |
| `final.puml` | Q&A and RECONSTRUCTION deliverable |
