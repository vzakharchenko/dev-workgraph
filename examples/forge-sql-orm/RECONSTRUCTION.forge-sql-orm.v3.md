## PROJECT DESCRIPTION

Forge SQL ORM is a TypeScript library that connects Atlassian Forge’s @forge/sql storage with the Drizzle ORM, providing a type‑safe, migration‑enabled, and performance‑aware database layer for Forge apps. It supplies a custom Drizzle driver, local in‑memory caching (Level 1), optional global KVS caching and Rovo analytics (Level 2), optimistic locking, vector/binary types, and an extensive query analysis framework that logs timeouts, OOM errors, and execution plans.

_Atlassian Forge platform, SQL database access, TypeScript ORM development, AI embeddings & similarity search, Caching & performance monitoring · TypeScript, Node.js, Drizzle ORM, @forge/sql, TiDB (Atlassian managed SQL), Level‑1 in‑memory cache, @forge/kvs (global KVS), Rovo analytics, npm, GitHub Actions CI, SonarCloud, DeepScan, Codacy, Snyk, REUSE compliance_

## Your IMPACT as Principal Developer

I architected and implemented Forge SQL ORM, a TypeScript library that bridges Atlassian Forge’s @forge/sql storage with Drizzle ORM. I designed the core architecture by implementing a custom Drizzle driver to replace MySQL2 and split the library into modular packages—core, CLI, and extra—to minimize client bundle sizes. To ensure data consistency in concurrent environments where traditional multi-statement transactions are unavailable, I implemented optimistic locking by integrating version columns across entity schemas and updating CRUD logic to prevent lost-update races. I expanded the ORM's capabilities by adding support for TiDB binary types (BINARY, VARBINARY, BLOB) and creating a custom `vectorFloat32` type for AI embeddings and similarity search, supported by typed SQL function helpers for Cast, Date, Numeric, and Vector operations.

To optimize performance within Forge's ephemeral execution environment, I designed a two-level caching strategy. Level 1 is an invocation-scoped in-memory cache that eliminates duplicate reads within a single resolver execution. Level 2 is a persistent global cache backed by @forge/kvs, acting as a virtual materialized view for expensive read-heavy queries across invocations. I implemented cache coherence through automatic invalidation on writes; the ORM tracks affected tables and evicts related L2 entries, optionally using a cache context to consolidate invalidations at the end of a resolver execution.

I developed a query analysis framework to address the difficulty of diagnosing SQL timeouts and OOM errors in Forge. Moving away from unstable platform summary data, I implemented a deterministic 'TopSlowest' mode that records SQL digests and timing within the resolver. For catastrophic failures, I implemented immediate post-mortem diagnostics that capture execution plans at the moment of failure without re-running the dangerous query. This framework integrates with EXPLAIN ANALYZE to identify inefficient joins or table scans and includes a PerformanceMonitor for tracking memory usage and latency thresholds. I presented this observability work at Atlas Camp 2026, demonstrating how tenant size variance can cause OOM errors even in fast queries—such as when permission-related ACL scans consume excessive memory—and showing how these patterns can be mitigated by decomposing queries and caching stable subqueries via @forge/kvs.

To support dynamic SQL for AI agents like Rovo, I implemented a guarded execution pattern for Row-Level Security (RLS). Since Forge SQL lacks native per-user session RLS, I built a multi-layer validation pipeline: a static AST pre-check to ensure queries are read-only and single-table, an EXPLAIN-based verification of the execution plan, and a post-execution metadata check to prevent cross-table leakage. This allows for the safe injection of application context into dynamic queries while ensuring that untrusted SQL is restricted to a guarded path.

I built a schema management pipeline featuring an idempotent migration engine with deterministic ordering and CLI tooling for entity generation. I added web triggers for applying migrations, flushing caches, and fetching schemas. To demonstrate these capabilities, I developed example projects including a hybrid search pipeline fusing TiDB VECTOR similarity with full-text scoring via Reciprocal Rank Fusion.

My technical approach was informed by extensive research into Forge SQL's practical limits, which I documented in two engineering articles for the Atlassian blog. In one, I analyzed query performance on a 600K row dataset, using TiDB EXPLAIN and EXPLAIN ANALYZE to demonstrate how to move from full table scans and HashJoins to efficient index operations and CTE-based pagination. The second article detailed the implementation of optimistic locking to solve concurrency conflicts in Forge apps. These research phases directly shaped the ORM's observability architecture and consistency primitives.

On the infrastructure side, I configured CI/CD pipelines to automate weekly snapshot publishing to GitHub Packages and enforced security standards using Codacy, Snyk, and REUSE headers. I hardened the supply chain by pinning third-party GitHub Actions to specific commit SHAs and implemented automated dependency management. I maintained code quality through unit testing of AST parsing logic, cache handlers, and migration utilities. My work has led to an early technical feedback loop with Atlassian, resulting in compatibility fixes for result ordering and timezone-dependent tests.

## Recalled context (this deepen round)

Another important external validation context is that I published two Forge SQL engineering articles on the Atlassian blog.

The first article, “Optimizing Forge SQL on a 600K database with TiDB EXPLAIN,” was focused on large-scale query performance under Forge SQL constraints. I built a realistic dataset with more than 600,000 rows across category, product, and order_item tables and used TiDB EXPLAIN and EXPLAIN ANALYZE to show how query plans, indexes, joins, memory usage, and OFFSET pagination behave inside Forge SQL.

The article demonstrated a step-by-step optimization path. The initial pagination query joined three tables and processed tens of thousands of rows even though it returned only 10 rows. It relied on full table scans, HashJoins, and memory-heavy TopN operations, taking more than 750 ms and consuming significant memory. Adding indexes improved execution time to around 414 ms, but the query still remained memory-sensitive at larger offsets. Rewriting the query with a CTE helped reduce join cost by limiting the large table first, and adding the right product indexes brought the final query down to around 16 ms with efficient index operations.

This article is important because it shows the practical foundation behind the query analysis and observability work in forge-sql-orm. It was not only about adding EXPLAIN support as a feature; it was about teaching Forge developers how to reason about execution plans, memory usage, pagination cost, full table scans, HashJoins, and index strategy under Forge’s 5-second execution limit and 16 MB per-query memory quota.

The second article, “Reliable Data Storage Using Optimistic Locking in Forge SQL,” focused on data consistency in concurrent Forge apps. I used a realistic Jira release checklist example where two users edit the same issue checklist and the last save can silently overwrite the earlier user’s valid changes. The article explained how optimistic locking solves this problem by using a version field such as updated_at or version and performing a single conditional UPDATE where the previous version must still match.

This pattern is especially important in Forge SQL because developers cannot rely on traditional multi-statement transaction flows in the same way they might in a normal database application. A single UPDATE with a version condition provides a practical way to prevent lost updates while staying within Forge SQL’s execution model.

Together, these articles show that forge-sql-orm was not only an implementation project. It also became a way to document and share production-oriented Forge SQL patterns with the Atlassian developer ecosystem: large dataset optimization, EXPLAIN-based diagnostics, index-aware query design, memory-limit awareness, and optimistic locking for concurrent data safety.

## Technologies

TypeScript, Drizzle ORM, Atlassian Forge, TiDB, Node.js

## Impact bullet points (Role Narrative)

- I architected and implemented Forge SQL ORM, a TypeScript library bridging @forge/sql with Drizzle ORM; I designed a custom driver to replace MySQL2 and modularized the project into core, CLI, and extra packages to minimize client bundle sizes.
- I developed a two-level caching architecture consisting of an invocation-scoped L1 in-memory cache to eliminate duplicate reads within a single resolver and a persistent L2 global cache using @forge/kvs for expensive read-heavy queries, implementing coherence via table-based automatic invalidation on writes.
- I implemented a query analysis framework that records SQL digests and timing at the resolver level to diagnose timeouts and OOM errors; I added immediate post-mortem diagnostics that capture execution plans upon failure without re-running dangerous queries, moving away from unstable platform summary data.
- I designed a guarded execution pattern for Row-Level Security (RLS) to support AI agents like Rovo, implementing a multi-layer validation pipeline featuring static AST pre-checks, EXPLAIN-based plan verification, and post-execution metadata checks to prevent cross-table leakage.

## CV bullets

- Architected a TypeScript ORM bridging @forge/sql with Drizzle ORM, implementing a custom driver and modular package system to minimize client bundle sizes.
- Designed a two-level caching strategy using invocation-scoped in-memory (L1) and global KVS (L2) layers with table-based automatic invalidation for coherence.
- Developed a query analysis framework providing resolver-level SQL digests and immediate post-mortem diagnostics to identify OOM errors and execution plan inefficiencies.
- Implemented a guarded execution pipeline for Row-Level Security featuring AST pre-checks and EXPLAIN-based verification to secure dynamic SQL for AI agents.

## Possible questions

**Q:** Given that Forge functions are ephemeral, how does the Level 1 in-memory cache provide tangible value, and what is your strategy for maintaining cache coherence between L1 and L2 when concurrent requests trigger updates across different execution environments?
**A:** The Level 1 cache was not designed to be a cross-request cache. In Forge, local memory is ephemeral, so L1 is intentionally scoped only to a single resolver invocation.

Its value comes from eliminating duplicate reads inside one execution path. A resolver can call several services, helper methods, permission checks, or data-loading functions, and these can accidentally request the same data multiple times. Without L1, the same SQL query or KVS lookup may be executed repeatedly during a single invocation. With L1, the first call loads the data, and subsequent calls in the same resolver execution return it directly from memory.

So L1 provides tangible value even in an ephemeral environment because it optimizes repeated work inside one invocation. It is not meant to survive cold starts or be shared across Forge executions.

Level 2 is the persistent layer. It uses @forge/kvs to store expensive read results across invocations, acting like an application-level virtual materialized view for read-heavy queries. This is useful for complex joins, aggregations, or derived read models where recomputing the SQL every time would risk Forge SQL timeout or memory limits.

For cache coherence, the main strategy is automatic invalidation on writes. Cacheable queries are associated with the tables they depend on. When data is changed through cache-aware ORM operations such as insert, update, or delete, the ORM tracks the affected tables and evicts related L2 cache entries.

For multi-step write flows, the ORM can use a cache context. Instead of evicting after every individual write, it collects all affected tables during the resolver execution and performs one consolidated invalidation step at the end. This keeps invalidation cheaper and more predictable.

L1 does not need cross-environment synchronization because it is invocation-scoped and disappears when the resolver finishes. After a write happens, the persistent L2 cache is invalidated, and future invocations will rebuild their own L1 state from either fresh L2 data or Forge SQL fallback.

So the short answer is: L1 reduces duplicate work within a single Forge invocation, while L2 provides cross-invocation reuse. Coherence is maintained by treating L1 as temporary execution-local state and invalidating L2 based on affected table dependencies after write operations.

**Q:** Since the RLS enforcement is implemented via an AST parser in the library, how do you ensure there are no security gaps for queries that might bypass these helpers, and what was the architectural trade-off in choosing client-side AST parsing over native database-level RLS?
**A:** The RLS layer in forge-sql-orm was not intended to replace database-level permissions for every possible SQL execution path. It was designed as a guarded execution pattern for dynamic read-only SQL, especially for scenarios where SQL can be generated by an AI agent such as Rovo.

The important boundary is that untrusted or AI-generated SQL must not be executed through arbitrary raw SQL paths. It should go through the guarded executor. That executor applies several validation layers before and after execution.

The first layer is a static AST pre-check. The SQL is parsed before execution to ensure that it is a single statement, that it is strictly a SELECT, that it targets only the allowed table, and that it does not use unsafe structures such as hidden scalar subqueries in selected columns.

The second layer is an EXPLAIN-based verification step. Before running the final query, the system inspects the execution plan and checks that every accessed object belongs only to the allowed table. This helps catch cases where the SQL text may look acceptable, but the actual execution plan would touch something unexpected through joins, subqueries, or optimizer behavior.

The third layer is a post-execution metadata check. After the query runs, the library validates the metadata returned by Forge SQL and ensures that fields with an origin table come from the expected table only. This provides a final check against cross-table leakage.

On top of this, the RLS logic is applied dynamically using application context. For example, the library can safely inject context parameters such as :currentUserId, :currentProjectKey, or :currentIssueKey, and then add RLS conditions based on the current user. A Jira admin can be allowed to see all rows, while a regular user can be restricted to rows where they are the creator or target user.

The reason for choosing this architecture is that Forge SQL does not provide a normal app-controlled native row-level security model that can be applied per Forge user session in the same way as a traditional database. Forge apps usually access the database through an application-level boundary, while authorization decisions often depend on Jira context, account ID, project key, issue key, or app-specific permissions.

So the trade-off was to enforce RLS at the application/ORM boundary, where the library has access to both the SQL query and the Forge/Jira user context. This makes the pattern practical for Rovo-style natural-language analytics while keeping dynamic SQL read-only, single-table, context-bound, and validated through multiple independent checks.

The security rule is that dynamic SQL must use the guarded RLS executor. If a developer bypasses the ORM and executes raw SQL directly, then they are also bypassing this protection. That is why the guarded executor exists as a specific safe path for AI-generated or user-generated analytics queries, not as a claim that every arbitrary SQL call in the application is automatically protected.

**Q:** Can you provide an example of a specific production performance bottleneck or OOM error that was identified via your query analysis framework, and how that insight led to a concrete architectural change in the ORM or the underlying schema?
**A:** One concrete example was the work around Timeout and OOM diagnostics in Forge SQL.

The problem was that severe SQL failures in Forge are difficult to diagnose after the fact. A query can be cancelled because it exceeded the 5-second SQL timeout or the 16MB memory limit, but the developer does not have direct access to the underlying TiDB instance or customer data. Platform-level summary tables can help, but they are not fully reliable for long-running resolvers or async flows because the relevant metadata can be evicted before the function finishes.

This insight changed the architecture of the query analysis framework.

Initially, the diagnostic flow relied more on TiDB summary metadata. After investigating how this behaves in Forge, I changed the default strategy to a deterministic TopSlowest mode. Instead of depending only on summary tables, the ORM records the SQL digest and timing information for queries executed inside the resolver. This means the developer can always see which ORM-generated queries participated in the invocation, even if platform summary metadata is no longer available.

For normal slow-query diagnostics, the framework can print the slowest queries and, when enabled, re-run them with EXPLAIN ANALYZE to show the execution plan. This helps identify concrete causes such as table scans, inefficient joins, bad pagination patterns, or missing indexes.

For catastrophic failures such as Timeout or OOM, I added a different path: immediate post-mortem diagnostics. Right after the error is caught, the ORM attempts to retrieve the execution plan while TiDB metadata is still fresh. This avoids re-running the same dangerous query, which could trigger the same timeout or memory failure again. It also avoids exposing tenant data because the diagnostic output is based on query metadata and execution plans, not customer content.

This led to a concrete architectural improvement in the ORM: query observability became resolver-level, deterministic, and configurable. The framework now supports TopSlowest as the default mode, optional SummaryTable mode with a short validity window, configurable slow-query thresholds, optional plan printing, and immediate OOM/Timeout post-mortem analysis.

So the main change was not only a schema optimization. It was an observability architecture change: the ORM moved from relying on unstable platform summary data to recording deterministic query participation and capturing failure diagnostics at the moment the SQL failure happens. This made performance issues actionable because a developer could connect a slow resolver or OOM failure to the exact query shape and execution plan that caused it.

**Q:** As the Principal Developer, how are you measuring the success of this ORM in terms of developer velocity and production stability across different teams, and what is the long-term plan for maintaining compatibility as Atlassian evolves the @forge/sql API?
**A:** I measure the success of forge-sql-orm mainly by whether it is useful in real Forge production applications and whether developers can build faster without losing control over Forge SQL behavior.

The library is already used in production, and the feedback so far is positive. For me, that is the strongest signal: the ORM is not only an experiment or a wrapper around @forge/sql, but a practical tool that helps developers work with Forge SQL in real applications.

The developer-velocity value comes from removing repeated low-level work. Instead of manually building SQL strings, handling result mapping, implementing migrations, optimistic locking, caching, query diagnostics, and TiDB-specific helpers separately in every app, developers can use one consistent library. This makes development faster and also makes the data-access patterns more repeatable.

On the production-stability side, the value comes from the patterns the ORM standardizes: optimistic locking for concurrent updates, two-level caching for expensive read paths, cache-aware invalidation, migration tooling, query analysis, OOM/timeout diagnostics, and guarded execution for dynamic SQL. These are all problems that Forge apps can run into independently, so having them centralized in the ORM reduces the chance that each team solves them differently.

For long-term compatibility with @forge/sql, the risk is manageable because the actual @forge/sql API surface is small. Conceptually, it is an abstraction where the application sends a SQL string with parameters and receives a JSON-like result. forge-sql-orm implements a driver on top of that boundary. The driver is intentionally relatively simple and integrates transparently with the rest of the ORM.

If Atlassian changes the result format or evolves the API, they will still need to preserve backward compatibility or deprecate methods gradually. In that case, the compatibility work would mostly be isolated inside the driver and low-level execution methods, rather than requiring the whole ORM to be rewritten.

Another important signal is that Atlassian is interested in the existence of this library and has already started contributing to the project. That gives me more confidence that the project is aligned with the Forge ecosystem rather than fighting against it.

So the short answer is: I measure success by production usage, developer satisfaction, reduced repeated implementation work, and the stability patterns the ORM brings to Forge apps. The long-term compatibility strategy is to keep the @forge/sql dependency isolated behind a small driver boundary and maintain that layer as the platform evolves.

**Q:** In your Atlas Camp session, you detailed how tenant size variance can cause OOMs even for fast queries. Did this lead to any specific 'tenant-aware' abstractions within the ORM—such as specialized helpers for decomposing permission checks or automated patterns for caching ACLs in L2—or is the ORM intended to provide the tools (KVS, observability) while leaving the decomposition strategy to the developer?
**A:** The Atlas Camp example did not lead to hardcoded ACL-specific helpers inside the ORM. I intentionally kept the ORM domain-agnostic. The problem was not specific to document permissions; it was a general pattern in Forge SQL: tenant size variance can make a query memory-heavy even when it is fast.

The ORM provides the primitives needed to solve this safely: resolver-level dbExecutionTime tracking, execution plan diagnostics, OOM/timeout post-mortem analysis, L2 KVS caching, deterministic cache keys, and table-based invalidation. These tools allow developers to identify which part of a query is expensive and then decide which stable subquery should be materialized or cached.

In the Atlas Camp example, the expensive part was the permission/ACL join, so the right optimization was to decompose the query and cache the stable permission lookup. But that strategy is application-specific. Another app may need to cache project visibility, issue access, reporting configuration, or derived dashboard data.

So the ORM does not automatically impose one permission-cache model. It gives developers the observability and caching infrastructure to build the correct decomposition for their domain. In that sense, the ORM is tenant-aware in diagnostics, because it helps detect tenant-size-related failures, but it remains domain-agnostic in optimization strategy.

**Q:** Since you implemented immediate post-mortem diagnostics for OOM and timeout failures, how is this diagnostic data actually captured and surfaced in production environments where developers don't have access to the logs of a specific tenant's failed invocation? Did you build a mechanism to ship these execution plans to an external observability sink or a dedicated Forge SQL log table?
**A:** The immediate post-mortem diagnostics are written to the application logs.

When an OOM or timeout happens, the ORM captures the diagnostic information as close to the failure as possible and logs the relevant details, such as the failed query digest, timing or memory-related metadata, and the execution plan when it is still available. The goal is to make the failure diagnosable without re-running the same dangerous query.

In production, the way developers access those diagnostics depends on the customer and environment permissions. If the developer has access to the relevant Forge or application logs, they can investigate the issue directly from the console.

If log access is restricted, the diagnostic flow becomes support-driven. The developer asks the customer, admin, or support contact to provide the relevant logs from the failed invocation. The logs can then be reviewed and used to identify which query failed, why it failed, and what optimization strategy is needed.

So I did not design the default flow around automatically shipping execution plans to an external observability sink or writing them into a dedicated Forge SQL table. The default surface is logs. External analytics or custom sinks can be added through callbacks if an app wants that, but the core mechanism is log-based because it keeps diagnostics inside the application boundary and avoids automatic data egress.

This fits the Forge model well: diagnostics are available when needed, but access remains controlled by the customer’s permissions and operational process.

**Q:** You mentioned that Atlassian has begun contributing to forge-sql-orm. To what extent has this collaboration evolved into a feedback loop where your findings on Forge SQL's limitations (like the memory-heavy ACL scans or metadata eviction) are influencing the actual development of the @forge/sql platform API?
**A:** I would describe the collaboration with Atlassian as an early practical feedback loop, not yet as a claim that forge-sql-orm directly drives the @forge/sql platform roadmap.

The contributions so far were concrete compatibility and correctness fixes. One fix was around a date-related test that was dependent on the local timezone. Another important fix was related to result ordering. Drizzle expects returned values to match the order of the selected fields, but in @forge/sql that ordering was not guaranteed in the same way. Atlassian addressed this by sorting the returned data according to the metadata included in the response.

That second case is important because it came from real integration behavior between Drizzle and @forge/sql. It shows that forge-sql-orm is useful not only as a library, but also as a way to discover edge cases in the Forge SQL developer experience.

At the same time, I would not overstate this as direct influence over large platform features. My findings around memory-heavy ACL scans, metadata eviction, timeout/OOM diagnostics, and query observability have been shared publicly through articles and my Atlas Camp session. They demonstrate practical limitations developers face when building production Forge SQL apps, especially with large tenants and complex queries.

So the feedback loop exists at two levels. At the library level, Atlassian has already contributed fixes that improve compatibility and correctness. At the platform level, my work provides concrete examples and developer feedback about where Forge SQL observability and diagnostics could improve, but I would describe that as ecosystem feedback rather than confirmed platform roadmap influence.

In short, Atlassian’s contributions show that the project is aligned with the Forge ecosystem and useful enough for platform engineers to engage with. But I would frame the current collaboration as early-stage technical feedback and compatibility improvement, not as a formal platform co-development process.

**Q:** Given Forge's strict resource constraints, what is the performance and memory overhead of the observability framework (e.g., tracking SQL digests, timing, and AST parsing) during a standard request? Did you have to implement any 'sampling' logic or toggleable levels of verbosity to ensure that the act of monitoring didn't itself trigger the OOM errors you were trying to diagnose?
**A:** The observability framework is designed to be lightweight by default.

Most of the standard observability data comes from the metadata returned by @forge/sql together with the query response. The most important signal there is dbExecutionTime, because it allows the ORM to understand how much time was actually spent inside the database without running additional diagnostic queries.

For normal requests, the framework mainly aggregates this metadata and compares it with developer-defined thresholds. A developer can define the expected database execution time for a resolver or query. If that threshold is exceeded, the framework can first write a debug-level message with timing information. At a higher diagnostic level, it can also write a warning with an execution plan.

The expensive part is execution-plan collection, so it is not done blindly for every request. There are three ways to collect plans.

The first option is to use statement summary tables. This is useful when observability is attached close to a single SQL query, because the relevant metadata is still fresh. However, it is less reliable for a whole resolver execution because Forge SQL statement-summary data can be evicted quickly.

The second option is to run EXPLAIN ANALYZE for the slowest query, or for several slow queries. This gives an accurate execution plan, but it executes the query again and blocks the current invocation, so it must be used carefully.

The third option is to run the same EXPLAIN ANALYZE asynchronously through an @forge/events queue. This avoids blocking the user request and is safer for production diagnostics, although the plan is collected later.

For OOM and timeout failures, the framework does not rely only on thresholds. These cases are detected by inspecting the error information returned by @forge/sql. When the error code indicates a timeout or out-of-memory failure, the ORM can trigger the post-mortem diagnostic flow and try to retrieve the relevant execution details while they are still available.

So the monitoring itself is not a heavy always-on profiler. The default path is metadata-based and low-overhead. More expensive diagnostics, such as execution-plan collection, are controlled by thresholds, verbosity levels, failure detection, or asynchronous processing.

**Q:** Did the process of writing these engineering articles—specifically the 600K row performance study—serve as the primary R&D phase for the ORM's observability framework, or was the library already architected to solve these problems before you decided to document them for the community?
**A:** The 600K-row article came from a research phase rather than from a fully finished observability framework.

At that point, I was trying to understand the real practical limits of Forge SQL: how much data it could handle, how pagination behaves on large datasets, how joins behave, where the 5-second timeout and 16 MB query memory limit start to matter, and which TiDB optimization tools are actually useful inside the Forge environment.

During that research, I started hitting real performance problems and memory-related errors. That is what pushed me to apply normal DBA-style diagnostic practices to Forge SQL: using EXPLAIN, EXPLAIN ANALYZE, reading execution plans, identifying full table scans and HashJoins, adding indexes, rewriting queries, and validating the result with actual execution metrics.

So the article was not just documentation of an already finished ORM feature. It was part of the exploration that shaped my understanding of what Forge SQL developers need in practice. The key insight was that Forge SQL needs better developer-facing observability because developers do not have direct database access, but they still need to reason about execution plans, memory usage, and failed queries.

After that, these findings influenced the direction of forge-sql-orm’s observability features. The library started to encode the same practical workflow: capture database execution time, identify slow or dangerous queries, inspect execution plans, and provide diagnostics for timeout and OOM failures.

So I would describe the relationship as research first, article second, and then the lessons from that research becoming part of the ORM’s observability architecture.

**Q:** Since you highlighted the lack of traditional transaction flows as a driver for optimistic locking, how does the ORM guide developers through 'pseudo-transactional' requirements—such as ensuring atomicity across multiple table updates—given that Forge SQL's constraints make standard ACID transactions difficult?
**A:** Forge SQL does not provide traditional transaction flows in the way developers may expect from a normal database application.

Each Forge SQL request is effectively a separate execution context, and the platform also has the important constraint that one .query() call can execute only one SQL query. Because of that, the ORM does not try to hide this limitation by pretending that multi-statement ACID transactions are available.

Instead, the ORM guides developers toward optimistic locking and conditional writes.

The core idea is that atomicity is guaranteed at the level of a single update statement. The frontend receives the current version of the entity together with the data. When the user sends an update, that original version is sent back to the backend. The backend then performs an update only if the stored version still matches the version the user originally read.

For example, the update condition includes both the record identity and the previous version. If another user has already updated the same record, the version in the database has changed. In that case, the update affects zero rows. The ORM can treat this as a concurrency conflict instead of silently overwriting someone else’s changes.

So the pattern is not “open transaction, read, modify, write, commit.” The pattern is “read with version, update with version check, detect conflict by affected rows.”

For multi-table flows, the developer still has to design the operation carefully because Forge SQL cannot guarantee atomicity across multiple independent statements. The ORM can provide safer building blocks—version fields, conditional updates, conflict detection, and predictable write helpers—but it cannot turn several separate Forge SQL calls into a real database transaction.

In practice, this means that important state changes should be modeled around a versioned aggregate or a single authoritative row when possible. If multiple derived tables need to be updated, they should either be recomputed, updated in an idempotent way, or protected by the same version/checkpoint pattern.

So the ORM does not solve pseudo-transactions by faking transactions. It makes the limitation explicit and provides optimistic-locking primitives that prevent lost updates within Forge SQL’s single-statement execution model.

**Q:** Regarding the optimization paths you documented (e.g., replacing OFFSET with CTEs), does the ORM provide high-level API abstractions that automatically implement these 'performance-safe' patterns, or is the library designed to stay out of the way and let the developer manually optimize the SQL using your provided diagnostics?
**A:** The ORM does not automatically rewrite arbitrary queries into “performance-safe” versions.

The optimization paths I documented, such as moving pagination into a CTE before joining large tables, are patterns that developers can apply intentionally after looking at the execution plan. I would not want the ORM to silently transform query structure, because that can change query semantics or make performance worse depending on indexes, ordering, data distribution, and the business meaning of the query.

For example, replacing OFFSET with a CTE can be very effective when the expensive part is joining or sorting a large dataset before applying LIMIT. But it is not universally correct. The query needs a stable ordering, the right indexes, and a clear understanding of which subset should be selected before the joins happen.

So the ORM is designed to provide the tools rather than hide the decision. It gives developers type-safe query construction, execution metadata, dbExecutionTime, slow-query diagnostics, EXPLAIN / EXPLAIN ANALYZE integration, timeout and OOM diagnostics, and caching primitives. These help developers see where the query is expensive and choose the right optimization strategy.

In that sense, the library stays out of the way at the SQL semantics level. It does not pretend to be a query optimizer. Forge SQL and TiDB are still responsible for executing the SQL, while the ORM helps developers understand what happened and apply proven patterns safely.

So the short answer is: the ORM provides diagnostics, examples, and building blocks for performance-safe patterns, but the developer remains responsible for choosing and applying the correct query rewrite for their domain.

**Q:** Given that you've established yourself as a thought leader on Forge SQL performance via the Atlassian blog, how do you manage the lifecycle of the ORM to ensure that the 'best practices' codified in the library remain aligned with the evolving TiDB/Forge platform without creating breaking changes for users who adopted those patterns based on your articles?
**A:** Given that you've established yourself as a thought leader on Forge SQL performance via the Atlassian blog, how do you manage the lifecycle of the ORM to ensure that the 'best practices' 
codified in the library remain aligned with the evolving TiDB/Forge platform without creating breaking changes for users who adopted those patterns based on your articles?

