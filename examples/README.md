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
| `.v2.md` … `.vN.md` | After one or more **`deepen`** rounds — recalled context + four new Q&A each time; cumulative **Possible questions**, richer IMPACT |

The [dev-workgraph](#dev-workgraph) and [forge-sql-orm](#forge-sql-orm) examples each include **v1–v5** (four `deepen` rounds) — useful to compare how the narrative evolves.

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

## [forge-sql-orm](forge-sql-orm/)

**Repository:** [github.com/forge-sql-orm/forge-sql-orm](https://github.com/forge-sql-orm/forge-sql-orm) · **Role:** Principal Developer

TypeScript ORM for Atlassian Forge **@forge/sql** (TiDB) built on Drizzle — custom driver, modular packages (core / CLI / extra), L1 in-memory + L2 **@forge/kvs** caching, optimistic locking, vector/binary types, query analysis (TopSlowest, timeout/OOM post-mortem), and guarded RLS for Rovo-style dynamic SQL.

| File | Notes |
|------|--------|
| [RECONSTRUCTION.forge-sql-orm.md](forge-sql-orm/RECONSTRUCTION.forge-sql-orm.md) | v1 after `final` |
| [RECONSTRUCTION.forge-sql-orm.v2.md](forge-sql-orm/RECONSTRUCTION.forge-sql-orm.v2.md) | deepen 1 — Atlas Camp 2026 talk on Forge SQL observability, enterprise OOM patterns, @forge/kvs decomposition |
| [RECONSTRUCTION.forge-sql-orm.v3.md](forge-sql-orm/RECONSTRUCTION.forge-sql-orm.v3.md) | deepen 2 — two Atlassian blog articles (600K-row EXPLAIN study, optimistic locking) |
| [RECONSTRUCTION.forge-sql-orm.v4.md](forge-sql-orm/RECONSTRUCTION.forge-sql-orm.v4.md) | deepen 3 — three-package split (`forge-sql-orm` / CLI / `forge-sql-orm-extra`), bundle-size feedback, core vs extra migration path |
| [RECONSTRUCTION.forge-sql-orm.v5.md](forge-sql-orm/RECONSTRUCTION.forge-sql-orm.v5.md) | deepen 4 (**latest**) — Forge SQL security research (VULN-1917751), `SQL_POLICY_VIOLATION` hardening, ORM 2.2.3 compatibility; **20** cumulative Q&A |

Good reference for an **open-source platform library** — Drizzle integration, modular packages, multi-tenant SQL performance, Atlassian blog / community validation, responsible disclosure, and production adoption with Atlassian feedback loop.

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

**Only example with multiple `deepen` rounds (v1 → v5)** — useful to compare how IMPACT and **Possible questions** grow as you add recalled context.

| File | Notes |
|------|--------|
| [RECONSTRUCTION.dev-workgraph.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.md) | v1 after `final` |
| [RECONSTRUCTION.dev-workgraph.v2.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v2.md) | deepen 1 — product motivation (perf review, interview prep, CV screeners, evidence grounding) |
| [RECONSTRUCTION.dev-workgraph.v3.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v3.md) | deepen 2 — architecture depth (point-in-time vs knowledge graph, noise categories, narrative model, UML pre-commit) |
| [RECONSTRUCTION.dev-workgraph.v4.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v4.md) | deepen 3 — OSS productization (npm publish, public README, examples) |
| [RECONSTRUCTION.dev-workgraph.v5.md](dev-workgraph/RECONSTRUCTION.dev-workgraph.v5.md) | deepen 4 (**latest**) — OSS adoption, model variability, security boundaries, plugin direction; **20** cumulative Q&A |

Good reference for a **tooling / DevEx repo**, **dogfooding** the pipeline on itself, and **iterative deepen** (read v2 → v5 in order).

---

## [remote-ctrl-gsm](remote-ctrl-gsm/)

**Repository:** [github.com/vzakharchenko/remote-ctrl-gsm](https://github.com/vzakharchenko/remote-ctrl-gsm) · **Role:** Staff Developer

Personal open-source project for remote climate and vehicle control on a Mitsubishi Outlander PHEV — proprietary binary protocol reverse engineering, **Smali** APK patching, Java crypto utilities, Docker VPN (PPTP / L2TP/IPsec), MikroTik automation, and SmartThings integration.

| File | Notes |
|------|--------|
| [RECONSTRUCTION.remote-ctrl-gsm.md](remote-ctrl-gsm/RECONSTRUCTION.remote-ctrl-gsm.md) | v1 after `final` — APK mod + networking stack + SmartThings; honest scope (personal car, not a generic IoT platform) |

**Scale:** ~**190 commits**; large APK-decompile commits with **thousands of `.smali` files** — a stress test for evidence export, path filter, and oversized-split summarize caps.

Good reference for **reverse-engineering / Android modding repos** — Smali-heavy diffs, mixed Java + infrastructure layers, and Q&A that separates authored design from decompiler output.

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
# optional — repeat for v3, v4, … → ./RECONSTRUCTION.<project>.v2.md, .v3.md, …
```

Stop anytime before `final` and re-run — completed stages are skipped. For review windows use `--period` ([Review periods](../README.md#review-periods)). Pipeline design: [`ARCHITECTURE.md`](../ARCHITECTURE.md) · full spec: [`REQUIREMENTS.md`](../REQUIREMENTS.md).
