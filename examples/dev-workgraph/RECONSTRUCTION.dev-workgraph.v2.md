## PROJECT DESCRIPTION

A tool designed to generate a developer work graph by analyzing Git history, patches, notes, and architectural context.

_Developer Experience (DevEx), Software Configuration Management, Knowledge Graph · Git_

## Your IMPACT as Staff Developer

I developed `dev-workgraph-cli`, a point-in-time analysis tool designed to reconstruct a developer's professional contributions by synthesizing Git history, patches, and human-provided context into an evidence-based career narrative. To establish the technical foundation, I defined a JSON schema for commit summaries that separates deterministic data—such as commits, file paths, and timestamps—from model-generated layers. This separation ensures that stable evidence remains distinct from narratives that may be regenerated as models evolve. I implemented schema versioning and stamped artifacts to ensure local analysis is reproducible and traceable, allowing reports to be tied to the specific pipeline version and model provenance that produced them. 

To ensure the resulting work graph reflects architectural evolution rather than commit volume, I refined area detection and noise filtering algorithms to deprioritize maintenance activity, such as dependency updates and application release commits. This prevents project upkeep from masking actual design changes or subsystem boundaries. As the architecture evolved, I introduced a `narrativeModel` slot to isolate the synthesis of reconstructed history from general reporting, ensuring human-provided context is integrated consistently into the final output.

I designed the system to reconstruct architectural context through a feedback loop rather than external synchronization. The tool analyzes Git evidence to identify gaps in intent or reasoning, generates targeted questions for the user, and incorporates the resulting answers as a separate context layer. This process transforms raw activity into role-based interpretation; while Git provides the factual boundary, human answers reframe that data to explain ownership and impact. To support this workflow, I mapped preconditions and evidence stages via UML diagrams and integrated a `TokenUsageTracker` for resource visibility. I also implemented a unit testing suite using Vitest across all primary CLI actions.

During implementation, I discovered that Git history alone was insufficient to capture design ownership, leading me to pivot the MVP requirements from raw activity visualization to an evidence pipeline. This pipeline converts raw evidence into structured signals—such as technical, architecture, or security signals—and ranks them by importance (high, medium, and low context). The `narrativeModel` then translates these confirmed signals and human-corrected context into a defensible narrative, including role summaries, impact bullet points, and CV bullets. To make these outputs useful for external review and automated screeners, I implemented an evidence-based normalization layer that maps internal project-specific jargon to standardized industry technical keywords without inventing generic strengths.

Ultimately, I scoped the tool as a mechanism for evidence interpretation rather than a simple commit counter. By grounding the final output in verified inputs—repository data, commits, and human corrections—the system helps developers reconstruct their actual work for performance reviews and interview preparation, ensuring that claims of architectural steering or technical impact are tied to concrete evidence.

## Recalled context (this deepen round)

One important product-level motivation behind dev-workgraph-cli is that it helps developers prepare for recurring career evaluation moments using evidence from their actual work.

The tool is not only intended to summarize Git history. Its purpose is to reconstruct a developer’s contribution from confirmed sources: their code, commits, patches, project structure, generated summaries, and their own answers to missing-context questions. This makes the output stronger than a generic AI-generated career narrative, because the final claims are grounded in evidence.

A practical use case is periodic performance review. Developers often need to explain what they worked on, what impact they had, which systems they owned, and which technical decisions they influenced. This is difficult to reconstruct from memory after several months. dev-workgraph-cli helps turn project history into structured evidence: role narrative, impact bullet points, architectural ownership, and possible review answers.

Another use case is interview preparation. The tool can identify a developer’s strong areas from real project history, such as architecture, security, performance, platform migration, testing, DevOps, or product ownership. It can then generate interview-ready explanations and CV bullets based on what the developer actually built, not on invented generic strengths.

The generated CV bullet points are especially important. They can help a developer describe their experience in a way that is clear for recruiters, hiring managers, and automated AI resume screeners. In theory, this can improve the chance of passing automated CV checks because the resume points are aligned with concrete technologies, architecture signals, and impact evidence found in the codebase.

The key differentiator from alternative tools is evidence grounding. Many tools can generate polished summaries, but they often rely on generic prompts or self-reported claims. dev-workgraph-cli builds the narrative from verified inputs: the developer’s repository, commits, code changes, generated evidence, and human corrections. This makes the final output more trustworthy and easier to defend in a performance review or interview.

So the product goal is not just “generate a resume from Git.” The goal is to create an evidence-based career reconstruction pipeline that helps developers explain their real work, pass performance reviews, prepare for interviews, and produce CV bullets that are grounded in confirmed sources rather than generic AI assumptions.

## Technologies

TypeScript, Git, Node.js, Ollama, Vitest

## Impact bullet points (Role Narrative)

- I designed and implemented `dev-workgraph-cli`, a point-in-time analysis tool that reconstructs developer contributions by synthesizing Git history, patches, and human-provided context into an evidence-based narrative.
- I defined a JSON schema for commit summaries that separates deterministic data from model-generated layers and implemented schema versioning with stamped artifacts to ensure local analysis is reproducible and traceable.
- I developed an evidence pipeline that converts raw Git activity into structured technical and architectural signals, utilizing noise filtering algorithms to deprioritize maintenance tasks like dependency updates in favor of design changes.
- I implemented a feedback loop mechanism that identifies gaps in Git evidence to generate targeted questions for the user, integrating these human-provided answers as a separate context layer to reframe technical activity into role-based impact.

## CV bullets

- Designed and implemented dev-workgraph-cli, a point-in-time analysis tool synthesizing Git history and patches into evidence-based narratives.
- Defined a JSON schema separating deterministic data from model layers with versioning and stamped artifacts for local traceability.
- Developed an evidence pipeline converting raw Git activity into structured architectural signals using noise filtering to isolate design changes.
- Implemented a feedback loop mechanism that identifies evidence gaps and integrates human-provided context to reframe technical activity as impact.

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

