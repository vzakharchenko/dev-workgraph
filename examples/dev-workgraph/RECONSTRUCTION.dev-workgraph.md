## PROJECT DESCRIPTION

A tool designed to generate a developer work graph by analyzing Git history, patches, notes, and architectural context.

_Developer Experience (DevEx), Software Configuration Management, Knowledge Graph · Git_

## Your IMPACT as Staff Developer

I developed `dev-workgraph-cli`, a point-in-time analysis tool designed to reconstruct developer work by analyzing Git history, patches, and human-provided context. To establish the technical foundation, I defined a JSON schema for commit summaries that separates deterministic data—such as commits, file paths, and timestamps—from model-generated layers. This separation ensures that stable evidence remains distinct from narratives that may be regenerated as models evolve. I implemented schema versioning and stamped artifacts to ensure local analysis is reproducible and traceable, allowing reports to be tied to the specific pipeline version and model provenance that produced them.

To ensure the resulting work graph reflects architectural evolution rather than commit volume, I refined area detection and noise filtering algorithms to deprioritize maintenance activity, such as dependency updates and application release commits. This prevents project upkeep from masking actual design changes or subsystem boundaries. As the architecture evolved, I introduced a `narrativeModel` slot to isolate the synthesis of reconstructed history from general reporting, ensuring human-provided context is integrated consistently into the final output.

I designed the system to reconstruct architectural context through a feedback loop rather than external synchronization. The tool analyzes Git evidence to identify gaps in intent or reasoning, generates targeted questions for the user, and incorporates the resulting human answers as a separate context layer. To support this workflow, I mapped preconditions and evidence stages via UML diagrams and integrated a `TokenUsageTracker` for resource visibility. I also implemented a unit testing suite using Vitest across all primary CLI actions.

During implementation, I discovered that Git history alone was insufficient to capture design ownership, leading me to refine the MVP requirements. I shifted the focus from raw activity visualization to an evidence pipeline—analyzing commits and patches, grouping related work, and identifying missing pieces—to better interpret architectural contribution. This pivot ensured the tool functions as a mechanism for evidence interpretation rather than a simple commit counter.

## Technologies

TypeScript, Git, Node.js, Ollama, Vitest

## Impact bullet points (Role Narrative)

- Designed and implemented a point-in-time analysis tool, dev-workgraph-cli, using a JSON schema that separates deterministic Git evidence (commits, file paths, timestamps) from model-generated narrative layers to ensure data integrity across reconstruction runs.
- Implemented schema versioning and artifact stamping within the pipeline to provide provenance for local analysis, ensuring generated reports are traceable to specific pipeline versions and model iterations.
- Developed noise filtering algorithms to deprioritize maintenance activity—such as dependency updates and release commits—ensuring the resulting work graph reflects architectural evolution rather than commit volume.
- Engineered a reconstruction feedback loop that identifies gaps in Git evidence to generate targeted questions for users, integrating human-provided answers as a distinct context layer to interpret design intent.

## CV bullets

- Designed dev-workgraph-cli using a JSON schema that decouples deterministic Git evidence from model-generated narratives to ensure data integrity.
- Implemented schema versioning and artifact stamping to provide provenance and traceability for local analysis across pipeline iterations.
- Developed noise filtering algorithms to deprioritize maintenance activity, ensuring work graphs reflect architectural evolution over commit volume.
- Engineered an evidence reconstruction loop that identifies gaps in Git history and integrates human-provided context as a distinct layer.

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

