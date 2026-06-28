## PROJECT DESCRIPTION

A tool designed to generate a developer work graph by analyzing Git history, patches, notes, and architectural context.

_Developer Experience (DevEx), Software Configuration Management, Knowledge Graph · Git_

## Your IMPACT as Staff Developer

I designed, implemented, and published `dev-workgraph-cli`, an open-source developer tool that reconstructs a professional's contributions by synthesizing Git history, patches, and human-provided context into an evidence-based career narrative. I scoped the tool as a point-in-time analysis utility rather than a shared organizational knowledge graph, focusing on local, reproducible reconstruction. To ensure this reproducibility, I implemented schema versioning and stamped artifacts, allowing every generated report to be traced back to the specific pipeline version, source report, and model provenance that produced it.

I architected the system to maintain a strict separation between deterministic data—such as commits, file paths, and timestamps—and model-generated layers. This ensures that stable evidence remains distinct from narratives that may evolve as models are updated. To prevent the tool from acting as a simple commit counter, I implemented area detection and noise filtering algorithms that deprioritize maintenance activity, such as dependency updates, routine upkeep, and application release commits. By treating these as secondary signals, I ensured the work graph reflects architectural evolution and design changes rather than just commit volume.

During implementation, I discovered that Git history alone was insufficient to capture design ownership, leading me to pivot the MVP into a structured evidence pipeline. This pipeline converts raw data into technical, architecture, or security signals, which are then ranked by importance (high, medium, and low context). To bridge the gap between raw evidence and role-based interpretation, I implemented a feedback loop: the system analyzes Git evidence to identify gaps in intent or reasoning, generates targeted questions for the user, and incorporates the resulting answers as a separate context layer. This process allows human input to reframe factual Git data into claims of ownership and impact without overriding the deterministic evidence.

To support this synthesis, I introduced a dedicated `narrativeModel` slot, decoupling narrative generation from the reporting logic. While the report model handles structured technical analysis, the narrative model translates confirmed signals and human-corrected context into defensible outputs, such as role summaries and CV bullets. To make these outputs effective for external review and automated screeners, I implemented an evidence-based normalization layer that maps internal project-specific jargon to standardized industry technical keywords based on detected signals.

I reinforced the system's operational stability by integrating a `TokenUsageTracker` for local resource visibility and implementing a comprehensive Vitest suite across all primary CLI actions. To prevent architectural drift, I automated UML diagram generation within the pre-commit workflow, ensuring visual documentation remains synchronized with the code. Finally, I productized the tool by publishing it as an open-source npm package, providing public documentation on local Ollama setup and review-period workflows, and including example reconstructions to demonstrate how the evidence evolves through the reconstruction rounds.

## Recalled context (this deepen round)

One important product context to add is that dev-workgraph-cli was not left as an internal MVP or local experiment. I published the first version of the application as an open-source npm package and updated the public GitHub repository, README, examples, and project metadata so that other developers can install and try it.

This changed the project status from an MVP implementation into an OSS product. The tool now has a public product position: evidence-based career reconstruction from Git history and human answers. It is designed to help developers prepare for performance reviews, CV updates, and interviews using defensible claims grounded in their own code, commits, and explanations.

Publishing the package also required turning the internal pipeline into something understandable and usable by others. I documented the value proposition, quick start, local Ollama model setup, review-period workflow, examples, repository layout, and the underlying work graph. I also added example reconstructions to demonstrate how the tool behaves on real projects and how the output evolves through final and deepen rounds.

This publication step is important for the impact narrative because it shows productization, not only implementation. The work was no longer just about proving that Git history can be summarized. It became a packaged developer tool with public documentation, examples, npm distribution, and a clear OSS use case.

So the reconstructed impact should describe dev-workgraph-cli as a designed, implemented, and published open-source developer tool. The wording should avoid framing it only as a prototype. It started from an MVP, but it crossed into a usable OSS product with a public installation path and evidence-based positioning.

## Technologies

TypeScript, Git, Node.js, LLM, BiomeJS

## Impact bullet points (Role Narrative)

- I designed and published `dev-workgraph-cli` as an open-source npm package, implementing a pipeline that reconstructs developer contributions by synthesizing Git history, patches, and human-provided context into evidence-based career narratives.
- I architected the system to maintain strict separation between deterministic data (commits, file paths) and model-generated layers, implementing schema versioning and stamped artifacts to ensure local reproducibility and provenance of every generated report.
- I implemented area detection and noise filtering algorithms to deprioritize maintenance activity—such as dependency updates and release commits—ensuring the work graph reflects architectural evolution rather than commit volume.
- I decoupled narrative generation from reporting logic by introducing a dedicated `narrativeModel` slot, enabling the system to translate confirmed technical signals and human-corrected context into role-specific outputs like CV bullets.

## CV bullets

- Designed and published dev-workgraph-cli, an open-source tool synthesizing Git history and patches into evidence-based career narratives.
- Architected a data pipeline separating deterministic Git evidence from model layers using schema versioning to ensure report provenance.
- Implemented area detection and noise filtering algorithms to isolate architectural evolution from routine maintenance and release activity.
- Decoupled narrative generation from reporting logic via a dedicated model slot to translate technical signals into role-specific outputs.

## Possible questions

**Q:** Given your focus on long-term traceability via schema versioning and stamped artifacts, is this architecture intended to support a persistent, shared knowledge graph across a larger organization, or is it scoped as a point-in-time analysis tool?
**A:** I scoped dev-workgraph-cli as a point-in-time analysis tool rather than a shared organizational knowledge graph.

The main goal was to reconstruct a developer’s work from Git history, patches, summaries, and human-provided context in a reproducible way. I wanted every generated artifact to be traceable: which source report was used, which schema version produced it, which model generated the narrative layer, and when it was created.

That is why I introduced schema versioning and stamped artifacts. They were not primarily designed for multi-tenant collaboration yet. They were designed to make local analysis reliable over time. If the schema evolves, old reports should still be understandable, migratable, or at least clearly tied to the version of the pipeline that produced them.

At the same time, I intentionally separated deterministic data from model-generated layers because this creates a foundation that could later support a persistent knowledge graph. Deterministic evidence, such as commits, files, patches, timestamps, and grouping metadata, should stay stable. Model-generated summaries and narratives can be regenerated or improved as models and prompts evolve.

So the short answer is: today it is a local point-in-time reconstruction tool with strong provenance guarantees. But the architecture keeps the door open for a future persistent graph, where multiple analysis runs, versions, projects, and human corrections could coexist without losing traceability.

**Q:** In refining the noise filtering and area detection algorithms, what specific categories of development activity were you designating as 'noise' to ensure the resulting work graph aligns with architectural context rather than just commit volume?
**A:** In dev-workgraph-cli, I treated “noise” mainly as maintenance activity that is necessary for the project but should not dominate the architectural reconstruction.

The main categories were dependency updates, routine maintenance tasks, and application release commits. These commits are important for keeping the project healthy, but they usually do not represent a new architectural decision, subsystem boundary, or ownership signal by themselves.

For example, a dependency update may touch many files and create a large diff, but it does not necessarily mean the developer redesigned the system. A release commit may change versions, changelogs, generated artifacts, or package metadata, but it mostly marks delivery rather than design evolution.

I did not want the work graph to behave like a commit-volume counter. Without filtering, maintenance and release activity could make some areas look more important than they really are. The goal was to make the graph reflect architectural context: schema design, pipeline stages, evidence processing, narrative reconstruction, reporting, and CLI workflow changes.

This does not mean maintenance commits are useless. They can still provide supporting evidence about project maturity, release discipline, and operational ownership. But they should be treated as secondary signals unless they are connected to a larger architectural change.

So the noise filtering strategy was designed to separate project upkeep from architectural evolution. It helps the final work graph explain what changed in the system design, not just which files changed most often.

**Q:** To better understand the integration with adjacent systems: where does the 'architectural context' and 'notes' data originate, and how do you ensure synchronization between these external sources and the Git history?
**A:** The architectural context and notes are not pulled automatically from external systems like Confluence or Notion.

In the current design, they are produced by the reconstruction workflow itself. The system first analyzes Git history at the commit level and extracts observations from commits, patches, file paths, and summaries. For each commit or group of commits, it also identifies missing pieces: information that Git evidence cannot explain on its own, such as intent, architectural reasoning, ownership, or whether a change was experimental or production-relevant.

The higher-level questions are then formed by aggregating and concatenating these commit-level observations and missing pieces. This allows the tool to move from isolated commit summaries to deeper architectural questions. For example, if several commits mention diagrams, evidence stages, notes, or reconstruction inputs, the system may ask where that context originates and how it relates to Git history.

The answers to these questions become the “notes” or “architectural context” layer. They are human-provided corrections and explanations that enrich the deterministic Git evidence. They are not treated as raw Git facts; they are stored as a separate context layer that can be tied back to the generated artifact, schema version, source report, and model provenance.

Synchronization is therefore handled through reconstruction traceability, not through live synchronization with an external documentation system. Git remains the deterministic evidence layer. The generated questions identify gaps in that evidence. Human answers fill those gaps and become contextual notes for the final narrative.

So the key idea is that architectural context is not imported as an external source of truth. It is reconstructed through a feedback loop: commit evidence → observations → missing pieces → aggregated questions → human answers → narrative context.

**Q:** You mentioned updating MVP requirements to align with the refined graph construction process; was this pivot driven by technical constraints discovered during implementation, or by a change in how stakeholders need to visualize subsystem ownership?
**A:** The refinement was driven mainly by technical discovery during implementation, not by an external stakeholder change.

While building dev-workgraph-cli, I found that Git history alone is not enough to reconstruct meaningful developer impact. Commits can show what changed, but they often cannot explain why it changed, whether the change represented architectural ownership, whether it was experimental or production-relevant, or how several commits connect into a larger design story.

Because of that, I refined the requirements around the graph construction process itself. The tool should not only summarize commits. It should build an evidence pipeline: analyze commits and patches, group related work, detect areas, identify missing pieces, generate questions, collect human answers, and then produce the final reconstruction narrative.

This changed the role of the work graph. It became less about visualizing raw subsystem ownership by commit volume and more about reconstructing design ownership from evidence. A developer may own an architectural direction even if the relevant work is spread across many small commits, refactorings, tests, documentation updates, and follow-up fixes.

So the requirements evolved because implementation showed that the core problem was not just graph visualization. The real problem was evidence interpretation. The graph needed to separate deterministic Git evidence from model-generated summaries and human-provided context, so the final output could explain architectural contribution rather than just count activity.

**Q:** To bridge the gap between raw evidence and a successful performance review, have you integrated specific narrative frameworks or impact-mapping patterns into the `narrativeModel` to ensure the reconstructed history is framed in terms of business value rather than just technical activity?
**A:** Yes, but the narrative framing is not done only at the final text-generation step. Before the narrativeModel produces the final story, the pipeline first builds structured signals for the analyzed period.

For each period, the system detects high-level contribution signals such as technicalSignal, architectureSignal, and securitySignal. Each signal includes reasons explaining why the model classified the work that way. For example, significant CLI changes, new model slots, schema versioning, enhanced serialization, or UML diagrams can raise technical and architecture signals, while the absence of security-relevant work keeps the security signal low.

The pipeline also separates context by importance level. hiContext contains the strongest evidence, such as introducing the CLI tool, commit and patch export, work-session grouping, local summarization through Ollama, UML diagrams, schema versioning, and the narrativeModel slot. mediumContext contains supporting work such as scope definition and broader unit test coverage. lowContext contains lower-impact activity such as initial project files, simple removals, or routine test/source changes.

After that, the system builds a period history from these signals and context layers. This history is still grounded in the actual project evidence, but it is already organized around contribution meaning rather than raw commit order.

The next important step is human Q&A. The generated questions are based on observations and missing pieces found in the evidence. The answers can directly affect the final impact narrative. They can explain intent, clarify ownership, identify production relevance, connect technical work to user value, or correct assumptions made from Git history alone.

This means the impact is not fixed after the first model pass. It is refined through a feedback loop: evidence creates signals, signals create questions, human answers add missing context, and the narrativeModel uses the combined result to produce the final role narrative, impact bullet points, CV bullets, and interview-ready explanations.

The narrativeModel does not invent business value from raw commits. Its job is to translate confirmed evidence and human-corrected context into a clear career narrative. If the answers show that a change reduced risk, enabled a new workflow, improved reliability, or demonstrated ownership, that context becomes part of the impact. If the answers show that something was only experimental or low-impact, the narrative can be adjusted accordingly.

So the impact mapping happens in layers: raw Git evidence is converted into signals, signals are explained through signalReasons, evidence is ranked into high/medium/low context, questions expose missing pieces, human answers refine the meaning, and only then does the narrativeModel turn it into performance-review or CV language.

This is important because it prevents the final narrative from becoming a generic AI summary. The final impact is derived from confirmed sources: code changes, commits, summaries, detected signals, and the developer’s own answers.

**Q:** Since you mentioned improving the chances of passing automated CV checks, how does the system handle the translation of internal project-specific jargon into the standardized technical keywords and architecture signals that external AI screeners typically look for?
**A:** The system handles this by separating internal project language from external career language.

Git history often contains project-specific names, internal commands, local module names, and implementation details that are meaningful inside the repository but not immediately useful for a CV or an automated screener. For example, names like deepen, prepare, final, narrativeModel, or finish archive are important inside the tool, but they need to be translated into broader technical categories.

The pipeline first extracts concrete evidence from the repository: files changed, commits, patches, technologies, CLI actions, tests, schemas, model integrations, and generated artifacts. Then it derives higher-level signals such as technical contribution, architecture contribution, security contribution, testing, maintainability, automation, or developer tooling.

This allows the final narrative to map internal implementation details to standardized external concepts. For example, narrativeModel can be framed as an LLM-based narrative synthesis layer. Schema versioning and stamped artifacts can be framed as provenance tracking and reproducible analysis. Commit grouping can be framed as Git history analysis and work-session reconstruction. Local Ollama integration can be framed as local AI/LLM processing. Vitest coverage can be framed as automated testing and workflow reliability.

The goal is not to stuff the CV with keywords artificially. The goal is to translate project-specific evidence into industry-recognizable language while keeping every claim grounded in the actual code and human answers.

This is especially useful for automated CV checks because those systems usually look for recognizable technologies, architecture patterns, and impact signals. A developer may have strong experience, but if it is described only using internal project names, an external screener may miss it. dev-workgraph-cli helps bridge that gap by producing CV bullets that include both the real project context and standardized technical keywords.

So the translation layer works as evidence-based normalization: internal project terms are preserved where needed, but the final output also explains them through broader concepts such as developer tooling, local LLM pipeline, Git analysis, schema versioning, provenance, test automation, CLI architecture, and architecture ownership.

**Q:** In the pursuit of 'evidence grounding,' how does the pipeline resolve contradictions between deterministic Git data and human-provided context, and which source takes precedence when generating the final defensible narrative?
**A:** The pipeline does not treat human-provided answers as a replacement for Git evidence. Instead, the questions are used to shift raw Git data toward role, ownership, and impact.

Git provides the factual boundary: commits, patches, files, timestamps, changed areas, and implementation details. However, Git usually describes activity in technical terms. It can show that I added a narrativeModel, introduced schema versioning, changed CLI actions, or added tests, but it does not automatically explain what role that work represents.

The generated questions are built from observations and missing pieces found in the Git evidence. Their purpose is to recover the context that Git cannot express: why the change mattered, what ownership it demonstrates, whether it was architectural or routine, and how it should be framed for performance review, interview preparation, or CV bullets.

So human answers do not override the deterministic data. They reframe it. They help move the narrative from “what files changed” to “what responsibility and impact this work shows.”

For example, Git may show schema versioning and stamped artifacts. The answer can explain that this was not just a serialization change, but part of a long-term traceability and reproducibility strategy. Git may show a new CLI action or model slot. The answer can explain that it represents separation between raw reporting and career-oriented narrative reconstruction.

If there is a contradiction, Git still controls the factual claim. But when the answer provides role context that is consistent with the evidence, the final narrative can become stronger and more accurate. The system can then describe not only the implementation, but the developer’s role behind it: architecture, ownership, reliability, maintainability, product direction, or career-impact framing.

In other words, Git is the evidence layer, and the question-answer step is the role-interpretation layer. The final defensible narrative is built by keeping the factual boundary from Git while using human answers to explain the meaning of that work.

**Q:** Given your focus on design ownership across subsystems, does the evidence pipeline include specific signals to differentiate between 'implementation work' and 'architectural steering,' or is that distinction currently reliant on the human-provided answers during the feedback loop?
**A:** The pipeline includes initial signals to differentiate implementation work from architectural steering, but the distinction is intentionally refined through the human feedback loop.

From Git evidence, the system can detect patterns that often indicate architectural work: introducing a new subsystem, defining schema boundaries, adding a new pipeline stage, creating model slots, changing artifact formats, adding UML diagrams, introducing versioning, or refactoring workflows across multiple CLI actions. These signals raise the architecture signal because they suggest changes to system structure rather than isolated feature implementation.

Implementation work is usually detected through more localized changes: adding a command, updating tests, modifying a helper, fixing behavior, or completing a specific workflow. This work can still be valuable, but by itself it does not always prove architectural steering.

However, Git can only show what changed. It cannot always prove whether the developer was following an existing direction or actively defining the direction. That is why the pipeline generates questions from observations and missing pieces. The questions ask for the role context behind the evidence: whether the developer designed the approach, why a boundary was introduced, what alternatives existed, and how the change affected the system.

So the system uses a layered approach. The evidence pipeline produces preliminary technical and architecture signals. Then the Q&A step shifts those signals toward role interpretation: implementation, ownership, architectural steering, reliability improvement, product direction, or operational maturity.

This prevents the final narrative from overstating the role based only on code changes. If the Git evidence shows broad structural changes and the human answers confirm design ownership, the final narrative can claim architectural steering. If the answers show that the work was mainly implementation of a predefined plan, the narrative should stay at the implementation level.

So the short answer is: the pipeline detects architectural signals automatically, but the final distinction between implementation work and architectural steering is confirmed through evidence-driven human answers.

**Q:** Given your implementation of schema versioning and the TokenUsageTracker, is this infrastructure intended to facilitate future organizational audits and cost-tracking across multiple users, or was it designed strictly to ensure the reproducibility of individual local analysis runs?
**A:** The primary goal was reproducibility of individual local analysis runs, not organizational audit or multi-user cost tracking.

dev-workgraph-cli is designed as a local-first tool. The generated artifacts should be explainable later: which schema version produced them, which source report was used, which model generated the output, and when the artifact was created. Schema versioning and stamped artifacts were introduced to make the pipeline durable as the data format evolves.

The TokenUsageTracker was added for local visibility and operational control. Running the pipeline over a real repository can be expensive in time and tokens, especially when summarizing hundreds of commits with local LLMs. Tracking token usage helps understand which stages are costly, compare model behavior, debug unexpectedly large prompts, and make future optimization decisions.

So the infrastructure is not currently designed as a centralized organizational audit system across multiple users. However, it does create the kind of provenance and usage metadata that could support that direction later. For example, if the tool were extended into a shared environment, schema stamps, model provenance, generation timestamps, source reports, and token usage would already provide useful building blocks for auditability and cost visibility.

In the current architecture, though, the main purpose is local reproducibility: every reconstruction should be traceable, repeatable, and tied to the exact pipeline version and model context that produced it.

**Q:** You decoupled the narrative generation from reporting logic via a dedicated model slot; was this architectural shift intended to allow for the seamless swapping of LLM providers, or to enable the system to generate multiple distinct narrative personas (such as an internal technical audit vs. an external career-focused summary) using the same evidence base?
**A:** The main reason for introducing a dedicated narrativeModel slot was separation of responsibility, not only model/provider swapping.

The reporting stage and the narrative stage solve different problems. The reportModel is responsible for structured analysis: aggregating commit groups, extracting signals, organizing technical context, and producing a report-like view of the work. The narrativeModel has a different role: it turns the evidence, signals, questions, and human answers into a role-aware story that can be used for performance reviews, CV bullets, and interview preparation.

This separation became important because the same evidence base can support different narrative outputs. For example, the same Git history may be framed as an internal technical reconstruction, a performance review narrative, a Staff-level ownership story, or external CV bullet points. These outputs should remain grounded in the same evidence, but they require different tone, structure, and level of abstraction.

So the architectural shift was primarily about enabling distinct narrative modes over the same confirmed evidence base. The system should not mix raw reporting with career-oriented interpretation. Reporting explains what happened in the repository. Narrative generation explains what that work means for a specific role.

The dedicated model slot also makes future model swapping easier. Different models may be better at code summarization, structured reporting, or long-form narrative synthesis. By separating reportModel and narrativeModel, the pipeline can choose the right model for each stage without changing the evidence flow.

So the short answer is: provider flexibility was a useful side effect, but the main design goal was to separate technical reporting from role-aware narrative reconstruction.

**Q:** By automating UML synchronization within the pre-commit workflow, are you establishing a standard for living documentation to facilitate onboarding and subsystem handovers within a team, or is this primarily a personal safeguard to prevent architectural drift during rapid MVP iteration?
**A:** The main reason was to keep the architecture diagrams synchronized with the actual pipeline without relying on manual discipline.

The project has several pipeline stages and generated artifacts, so the diagrams are useful only if they stay close to the current implementation. If UML diagrams are updated manually, they can quickly become outdated during active development. By automating UML regeneration in the pre-commit workflow, I made the documentation easier to maintain and reduced the risk of architectural drift.

At this stage, the primary goal was not to establish a formal team handover process. It was a practical engineering safeguard: when the pipeline changes, the visual representation can be regenerated automatically, so the architecture documentation remains aligned with the code.

At the same time, this also creates a foundation for living documentation. Even if the immediate use case was personal maintainability, synchronized diagrams make the project easier to understand later, whether for onboarding, review, or explaining subsystem boundaries.

So the short answer is: it started as a safeguard against documentation drift, but the benefit is broader. Automated UML regeneration makes the architecture easier to keep current and turns the diagrams into maintainable living documentation rather than static drawings that become obsolete.

**Q:** Regarding the area detection algorithms used to filter noise: are these boundaries defined as static global heuristics, or have you designed the system to allow for project-specific configuration so that different teams can define what constitutes 'maintenance' versus 'architectural signal' based on their own Git conventions?
**A:** The boundaries are currently defined as default pipeline rules, and the main maintenance categories are treated as noise.

For dev-workgraph-cli, maintenance means changes such as dependency updates, version bumps, release commits, package metadata updates, and routine upkeep tasks. These changes are important for keeping the project healthy, but they do not usually change the product functionality or represent a new architectural decision.

Because of that, I do not want them to influence the impact narrative. A dependency update or release commit may touch many files, but it should not increase the perceived technical or architectural impact of the period. It is project maintenance, not role evidence.

The purpose of noise filtering is to prevent the graph from confusing activity with contribution. Without this filtering, routine maintenance could make the work look more significant than it really was simply because it produced Git changes.

So the rule is intentionally conservative: maintenance activity is still preserved as part of the project history, but it is treated as low-impact context. It can show operational discipline and project upkeep, but it should not drive the main role narrative, architecture signal, or CV bullets unless it is connected to a real functional or architectural change.

**Q:** Now that dev-workgraph-cli is an OSS product intended for other developers, have you had to evolve the evidence pipeline—specifically the area detection and noise filtering—to handle a wider variety of repository patterns and commit conventions beyond your own, or is the tool currently optimized for a specific style of development workflow?
**A:** The pipeline is not primarily based on commit-message conventions. The main source of evidence is the code diff itself.

Commit messages can provide useful context, but they are treated as secondary information. The system analyzes what actually changed: files, patches, affected areas, added or removed code, schema changes, tests, documentation, configuration, and relationships between changes. This makes the pipeline less dependent on a specific development workflow or commit style.

Because of that, different commit-message conventions are not the main problem. A developer may use conventional commits, short messages, squash commits, or inconsistent messages, but the pipeline still has the code changes as the factual evidence layer.

For area detection and noise filtering, the important distinction is whether the diff represents functional or architectural change versus maintenance activity. Dependency updates, version bumps, release commits, package metadata changes, and routine upkeep can be detected from the changed files and patch content, not only from the commit message.

So the OSS version is not optimized only for my personal commit-message style. It is designed around diff-based evidence. Commit messages help with context, but the final reconstruction should be grounded in the actual repository changes and then refined through human answers when Git cannot explain intent or role.

**Q:** By opening the tool to the public with a local Ollama setup, you've introduced variability in model performance. Have you implemented any validation layers or prompt-engineering safeguards to ensure that the 'evidence-based' nature of the reconstruction remains consistent and defensible regardless of which specific local model the user is running?
**A:** Opening the tool as an OSS product with local Ollama support does introduce variability, because different local models can produce different quality summaries and narratives.

I do not assume that every local model will behave the same way. Instead, the pipeline is designed so that the evidence-based nature of the reconstruction does not depend only on the final narrative model.

The first safeguard is separation between deterministic evidence and model-generated layers. Commits, patches, file paths, timestamps, changed areas, and source reports are treated as the factual layer. Model output is built on top of that evidence, but it does not replace it.

The second safeguard is schema-driven generation. The pipeline expects structured outputs for commit summaries, reports, questions, and reconstructed narratives. Schema versioning and stamped artifacts make it possible to know which pipeline version, source report, and model context produced a result. This makes the output easier to inspect, reproduce, or regenerate with a different model.

The third safeguard is the human-in-the-loop step. The model can identify observations and missing pieces, but the final interpretation is refined through user answers. This is important because Git can show what changed, but it cannot always explain ownership, intent, or impact. Human answers add that missing role context without overriding the underlying Git evidence.

The fourth safeguard is provenance. The generated report keeps track of the source report, model, generation time, and schema version. If a user runs a weaker local model, the result may be less polished, but it is still possible to trace where the claims came from and rerun the narrative stage with a stronger model.

So I would not claim that every local Ollama model produces the same quality output. The stronger claim is that the pipeline is designed to keep evidence, model interpretation, and human correction separate. That separation helps keep the reconstruction defensible even when model quality varies.

In other words, the model writes the interpretation, but the repository evidence, schema validation, provenance metadata, and human answers keep the narrative grounded.

