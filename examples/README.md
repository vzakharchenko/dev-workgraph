# Example reconstructions

Sample **`RECONSTRUCTION.<project>.md`** files produced by [dev-workgraph](../dev-workgraph-cli/) on real repositories. They are **not** hand-written CV text — each file is the CLI output after Git evidence extraction, local LLM passes, interactive Q&A (`final`), and optionally **`deepen`**.

Use them to see what a performance-review / CV narrative looks like when it is grounded in commits, signals, and confirmed answers rather than a generic prompt.

| Suffix | Meaning |
|--------|---------|
| *(none)* | First `final` — four prepared questions answered, v1 finish archive |
| `.v2.md` | After **`deepen`** — recalled non-code context + four new Q&A rounds, richer IMPACT and CV bullets |

Files here are **copies for documentation**; your own runs write `RECONSTRUCTION.*.md` to the directory where you invoke the CLI.

Runs referenced in the root [README](../README.md) used a **MacBook Pro M4 Pro (48 GB)** and local Ollama (`qwen2.5-coder:14b` / `gpt-oss:latest` / `gemma-4-31B`).

---

## [Forge Secure Notes for Jira](Forge-Secure-Notes-for-Jira/)

**Repository:** [github.com/ForgeRock/Forge-Secure-Notes-for-Jira](https://github.com/ForgeRock/Forge-Secure-Notes-for-Jira)

Zero-trust Jira Forge app for sharing ephemeral encrypted notes inside issues — client-side AES-GCM, out-of-band key exchange, Forge SQL + KVS split storage, JSM portal support, Rovo AI analytics with AST validation.

| File | Role | Notes |
|------|------|--------|
| [RECONSTRUCTION.Forge-Secure-Notes-for-Jira.md](Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.md) | Principal Developer | v1 after `final` |
| [RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md](Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) | Principal Developer | v2 after `deepen` — adds recalled context on email sharing vs decryption keys |

**Scale:** ~**300 commits** in the analyzed history; unattended pipeline stages took **~6 hours** on the hardware above before interactive questions.

Good reference for a **large, security-heavy product repo** — architectural steering, encryption boundaries, CI/CD, and long-form Q&A under **Possible questions**.

---

## [dev-workgraph](dev-workgraph/)

**Repository:** [github.com/vzakharchenko/dev-workgraph](https://github.com/vzakharchenko/dev-workgraph) (this monorepo)

The CLI that produced these examples — evidence pipeline, schema versioning, finish question files, Q&A feedback loop, token usage tracking, Vitest coverage.

| File | Role | Notes |
|------|------|--------|
| [RECONSTRUCTION.dev-workgraph.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.md) | Staff Developer | v1 after `final` |
| [RECONSTRUCTION.dev-workgraph.v2.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v2.md) | Staff Developer | v2 after `deepen` — product motivation (perf review, interview prep, CV screeners) |

Good reference for a **tooling / DevEx repo** and for **dogfooding** the pipeline on the project itself.

---

## How to reproduce

```bash
cd /path/to/cloned/repo
npx dev-workgraph run .
# answer questions when prompted → ./RECONSTRUCTION.<project>.md
npx dev-workgraph deepen .
# optional second round → ./RECONSTRUCTION.<project>.v2.md
```

Pipeline stages before `final` can be **interrupted and resumed**; see [dev-workgraph-cli/README.md](../dev-workgraph-cli/README.md).
