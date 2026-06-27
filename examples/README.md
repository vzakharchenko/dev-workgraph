# Example reconstructions

Sample **`RECONSTRUCTION.<project>.md`** files from [dev-workgraph](../README.md) — a career story you can defend for a performance review, a CV, or interview prep.

Each file is **CLI output**, not hand-written CV text: Git evidence → local LLM passes → your answers at **`final`** → optionally **`deepen`**. Claims are tied to commits, signals, and what **you** confirmed — not a generic ChatGPT prompt. The tool does **not** invent customer impact or production usage unless you stated it in an answer.

| You need to see… | Look for in each file |
|------------------|------------------------|
| **Performance review** | **Your IMPACT**, role narrative bullets, technologies |
| **CV / resume** | Four **CV bullets** with stack and architecture keywords from the repo |
| **Interview prep** | Narrative of what was built + **Possible questions** with grounded answers |

| Suffix | Meaning |
|--------|---------|
| *(none)* | First `final` — four prepared questions answered, v1 finish archive |
| `.v2.md` | After **`deepen`** — recalled non-code context + four new Q&A rounds, richer IMPACT and CV bullets |

Files here are **copies for documentation**; your own runs write `RECONSTRUCTION.*.md` to the directory where you invoke the CLI.

Runs used a **MacBook Pro M4 Pro (48 GB)** and local Ollama: `qwen2.5-coder:14b` / `gpt-oss:latest` / `gemma4:31b`. See [Quick start](../README.md#quick-start) and [`dev-workgraph-cli/README.md`](../dev-workgraph-cli/README.md) for install and commands.

---

## [Forge Secure Notes for Jira](Forge-Secure-Notes-for-Jira/)

**Repository:** [github.com/ForgeRock/Forge-Secure-Notes-for-Jira](https://github.com/ForgeRock/Forge-Secure-Notes-for-Jira) · **Role:** Principal Developer

Zero-trust Jira Forge app for sharing ephemeral encrypted notes inside issues — client-side AES-GCM, out-of-band key exchange, Forge SQL + KVS split storage, JSM portal support, Rovo AI analytics with AST validation.

| File | Notes |
|------|--------|
| [RECONSTRUCTION.Forge-Secure-Notes-for-Jira.md](Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.md) | v1 after `final` |
| [RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md](Forge-Secure-Notes-for-Jira/RECONSTRUCTION.Forge-Secure-Notes-for-Jira.v2.md) | v2 after `deepen` — recalled context on email sharing vs decryption keys |

**Scale:** ~**300 commits**; unattended stages **~6 hours** before interactive questions on the hardware above.

Good reference for a **large, security-heavy product repo** — architectural steering, encryption boundaries, CI/CD, and long-form Q&A under **Possible questions**.

---

## [keycloak-radius-plugin](keycloak-radius-plugin/)

**Repository:** [github.com/vzakharchenko/keycloak-radius-plugin](https://github.com/vzakharchenko/keycloak-radius-plugin) · **Role:** Staff Developer (open-source IAM)

Open-source Java plugin that embeds a RADIUS server in Keycloak — RadSec, CoA, OTP/WebAuthn, vendor SPI (Mikrotik, Cisco, ChilliSpot), Docker/CI releases, and continuous migration across Keycloak 9.x–26.x (WildFly → Quarkus).

| File | Notes |
|------|--------|
| [RECONSTRUCTION.keycloak-radius-plugin.md](keycloak-radius-plugin/RECONSTRUCTION.keycloak-radius-plugin.md) | v1 after `final` |
| [RECONSTRUCTION.keycloak-radius-plugin.v2.md](keycloak-radius-plugin/RECONSTRUCTION.keycloak-radius-plugin.v2.md) | v2 after `deepen` — open-source adoption, release flow, Mikrotik/Hetzner validation vs community vendor integrations |

Good reference for a **long-lived open-source infrastructure project** — protocol design, platform migrations, extensibility (SPI), and honest scope in answers (what you validated vs what the community contributed).

---

## [dev-workgraph](dev-workgraph/)

**Repository:** [github.com/vzakharchenko/dev-workgraph](https://github.com/vzakharchenko/dev-workgraph) (this monorepo) · **Role:** Staff Developer

The CLI that produced these examples — evidence pipeline, schema versioning, finish question files, Q&A feedback loop, work graph / provenance, Vitest coverage.

| File | Notes |
|------|--------|
| [RECONSTRUCTION.dev-workgraph.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.md) | v1 after `final` |
| [RECONSTRUCTION.dev-workgraph.v2.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v2.md) | v2 after `deepen` — product motivation (perf review, interview prep, CV screeners, evidence grounding) |

Good reference for a **tooling / DevEx repo** and for **dogfooding** the pipeline on the project itself.

---

## How to reproduce

**Prerequisites:** Node.js 20+, Git, [Ollama](https://ollama.com).

```bash
brew install ollama
ollama pull qwen2.5-coder:14b
ollama pull gpt-oss:latest
ollama pull gemma4:31b
ollama serve
```

```bash
cd /path/to/cloned/repo
npx dev-workgraph run .
# answer questions when prompted → ./RECONSTRUCTION.<project>.md
npx dev-workgraph deepen .
# optional second round → ./RECONSTRUCTION.<project>.v2.md
```

Stop anytime before `final` and re-run — completed stages are skipped. For review windows use `--period` ([Review periods](../README.md#review-periods)). Pipeline design: [`ARCHITECTURE.md`](../ARCHITECTURE.md) · full spec: [`REQUIREMENTS.md`](../REQUIREMENTS.md).
