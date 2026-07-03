## PROJECT DESCRIPTION

Forge SQL ORM is a TypeScript library that connects Atlassian Forge’s @forge/sql storage with the Drizzle ORM, providing a type‑safe, migration‑enabled, and performance‑aware database layer for Forge apps. It supplies a custom Drizzle driver, local in‑memory caching (Level 1), optional global KVS caching and Rovo analytics (Level 2), optimistic locking, vector/binary types, and an extensive query analysis framework that logs timeouts, OOM errors, and execution plans.

_Atlassian Forge platform, SQL database access, TypeScript ORM development, AI embeddings & similarity search, Caching & performance monitoring · TypeScript, Node.js, Drizzle ORM, @forge/sql, TiDB (Atlassian managed SQL), Level‑1 in‑memory cache, @forge/kvs (global KVS), Rovo analytics, npm, GitHub Actions CI, SonarCloud, DeepScan, Codacy, Snyk, REUSE compliance_

## Your IMPACT as Principal Developer

I architected and implemented Forge SQL ORM, a TypeScript library that bridges Atlassian Forge’s @forge/sql storage with Drizzle ORM. To ensure the library remained lightweight for most users while providing advanced capabilities for production apps, I designed a three-package ecosystem: a core package for runtime integration, a CLI for developer tooling and migration generation, and an extra package for heavier optional features. This modularity was a direct response to user feedback regarding bundle size and build issues caused by dependencies like node-sql-parser; by moving advanced SQL parsing, Rovo integration, and global caching into the extra package, I ensured that the common path remained stable without breaking backward compatibility.

To address data consistency in Forge's ephemeral environment where traditional multi-statement transactions are unavailable, I implemented optimistic locking. I integrated version columns across entity schemas and updated CRUD logic to detect concurrency conflicts by checking affected rows, guiding developers toward a conditional-write pattern rather than attempting to simulate ACID transactions. I further expanded the ORM’s capabilities by adding support for TiDB binary types (BINARY, VARBINARY, BLOB) and creating a custom `vectorFloat32` type for AI embeddings and similarity search, supported by typed SQL function helpers for Cast, Date, Numeric, and Vector operations.

To optimize performance within Forge's resource constraints, I designed a two-level caching strategy. Level 1 is an invocation-scoped in-memory cache that eliminates duplicate reads within a single resolver execution. Level 2 is a persistent global cache backed by @forge/kvs, acting as a virtual materialized view for expensive read-heavy queries across invocations. I implemented cache coherence through automatic invalidation on writes; the ORM tracks affected tables and evicts related L2 entries, optionally using a cache context to consolidate invalidations at the end of an execution.

I developed a query analysis framework to solve the difficulty of diagnosing SQL timeouts and OOM errors in Forge. Moving away from unstable platform summary data, I implemented a deterministic 'TopSlowest' mode that records SQL digests and timing within the resolver. For catastrophic failures, I added immediate post-mortem diagnostics that capture execution plans at the moment of failure before metadata is evicted, writing these details to application logs for support-driven investigation. This framework integrates with EXPLAIN ANALYZE to identify inefficient joins or table scans and includes a PerformanceMonitor for tracking memory usage and latency thresholds. My research into these patterns, including a performance study on a 600K row dataset using TiDB EXPLAIN, directly shaped the ORM’s observability architecture and was presented at Atlas Camp 2026.

To support dynamic SQL for AI agents like Rovo, I implemented a guarded execution pattern for Row-Level Security (RLS). Because Forge SQL lacks native per-user session RLS, I built a multi-layer validation pipeline: a static AST pre-check to ensure queries are read-only and single-table, an EXPLAIN-based verification of the execution plan, and a post-execution metadata check to prevent cross-table leakage. This allows for the safe injection of application context into dynamic queries while restricting untrusted SQL to a guarded path.

I built a schema management pipeline featuring an idempotent migration engine with deterministic ordering and CLI tooling for entity generation. I added web triggers for applying migrations, flushing caches, and fetching schemas. To demonstrate these capabilities, I developed example projects including a hybrid search pipeline fusing TiDB VECTOR similarity with full-text scoring via Reciprocal Rank Fusion.

Beyond library development, I used the ORM as a research surface to investigate Forge SQL internals and tenant isolation boundaries. Through a responsible disclosure process with Atlassian Product Security (VULN-1917751), I identified an isolation gap where database-level metadata could create unexpected cross-tenant interaction paths. This research led to a platform-level hardening update from Atlassian, which introduced pre-execution query monitoring and the `SQL_POLICY_VIOLATION` error to reject restricted functions and optimizer hints. Following this update, I performed a compatibility audit of the ORM and released version 2.2.3 to fix slow-query filtering logic that relied on a now-blocked optimizer hint, ensuring the library remained compatible with the hardened platform.

On the infrastructure side, I configured CI/CD pipelines to automate weekly snapshot publishing to GitHub Packages and enforced security standards using Codacy, Snyk, and REUSE headers. I hardened the supply chain by pinning third-party GitHub Actions to specific commit SHAs and implemented automated dependency management. My work has established an early technical feedback loop with Atlassian, resulting in compatibility fixes for result ordering and timezone-dependent tests, positioning the library as a practical reference implementation for the Forge SQL ecosystem.

## Recalled context (this deepen round)

Another important context that is not fully visible from Git history is the security research and platform-hardening feedback loop around Forge SQL.

During the development and maintenance of forge-sql-orm, I spent a lot of time researching Forge SQL internals, execution plans, slow query observability, metadata behavior, and tenant isolation boundaries. This research was not limited to ORM features. It also uncovered architectural edge cases in Forge SQL itself, including possible cross-tenant interaction paths through database-level metadata and restricted SQL behavior.

I responsibly shared these findings with Atlassian engineering. After this research and disclosure process, Atlassian shipped a Forge SQL security hardening update. Forge SQL now inspects submitted queries before they reach the database and rejects restricted functions, statements, optimizer hints, and SQL patterns with a new SQL_POLICY_VIOLATION error. This is an important platform-level improvement because it adds pre-execution protection against SQL-based resource exhaustion, unsafe statements, and metadata-level abuse.

This is important for the reconstruction because it shows that the work around forge-sql-orm was not only library development. The ORM became a practical research surface for understanding Forge SQL behavior, testing platform boundaries, and responsibly reporting security-relevant findings back to Atlassian. I am glad that this research helped contribute to a safer Forge SQL platform for the whole ecosystem.

After Atlassian shipped the hardening update, I also had to maintain compatibility in forge-sql-orm. Normal ORM usage was not affected: CRUD operations, migrations, pagination, optimistic locking, caching, and regular query execution continued to work as before. The affected area was optional slow query log / execution plan observability.

Before the platform change, the slow query observability flow used the tidb_session_alias optimizer hint to distinguish application queries from system queries during slow query log analysis. After the Forge SQL policy update, that hint could be rejected with SQL_POLICY_VIOLATION. This meant that the optional scheduled observability job could fail for apps that enabled slow query log collection in the Forge Developer Console.

I created a follow-up issue in forge-sql-orm to track the platform hardening impact and then fixed the slow query filtering logic. The fix removed the dependency on the blocked optimizer hint and replaced it with a filtering approach compatible with the new Forge SQL query policy. I released this compatibility update in forge-sql-orm 2.2.3.

This was an unusual and important example of the full lifecycle of platform-oriented OSS work: research an underlying platform behavior, responsibly disclose security findings to the vendor, see the platform hardened, identify the downstream compatibility impact on the open-source library, update the library, and communicate the impact clearly to users.

The key point is that forge-sql-orm was not only consuming the Forge SQL platform. It also helped reveal real platform edge cases, and the follow-up work kept the ecosystem compatible after Atlassian improved the security model.

## Technologies

TypeScript, Drizzle ORM, Atlassian Forge, TiDB, Node.js

## Impact bullet points (Role Narrative)

- I architected and implemented a TypeScript ORM for @forge/sql using Drizzle ORM, designing a modular three-package ecosystem (core, CLI, extra) to isolate heavy dependencies like node-sql-parser and Rovo integration from the runtime path to minimize client bundle sizes.
- I designed a high-performance data access layer featuring optimistic locking for concurrency control in ephemeral environments and a two-level caching strategy—combining an invocation-scoped L1 in-memory cache with a persistent L2 @forge/kvs global cache—including automatic table-based invalidation logic.
- I developed a query analysis framework to diagnose SQL timeouts and OOM errors, implementing deterministic 'TopSlowest' recording and immediate post-mortem diagnostics that capture execution plans at the moment of failure before metadata eviction occurs.
- I conducted security research into Forge SQL tenant isolation boundaries, responsibly disclosing a cross-tenant metadata leakage vulnerability (VULN-1917751) to Atlassian, which led to a platform-level hardening update and subsequent compatibility fixes in version 2.2.3 of the ORM.

## CV bullets

- Architected a modular TypeScript ORM ecosystem for @forge/sql using Drizzle, splitting core runtime, CLI tooling, and optional extensions to minimize client bundle sizes.
- Designed a high-performance data access layer featuring optimistic locking for concurrency control and a two-level caching strategy combining invocation-scoped L1 memory and persistent L2 KVS.
- Developed a query analysis framework providing deterministic slow-query recording and immediate post-mortem diagnostics to capture execution plans during SQL timeouts and OOM errors.
- Conducted security research on tenant isolation boundaries, disclosing a cross-tenant metadata leakage vulnerability (VULN-1917751) that resulted in an Atlassian platform-level hardening update.

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
**A:**For the 600K-row performance article, I built the example project that demonstrates the same optimization path described in the article. That example is part of the project’s test and validation package. I keep it updated together with the ORM and periodically run it to check how the pattern behaves as Forge SQL, TiDB, and @forge/sql evolve.

This is important because performance guidance can become outdated if it only exists as a blog post. By keeping the example in the repository, I can validate whether the documented approach still works in practice: large data generation, EXPLAIN / EXPLAIN ANALYZE usage, index strategy, query rewrites, and Forge SQL behavior under platform limits.

At the same time, I do not hardcode those optimization patterns as automatic query rewrites in the ORM. The library provides stable primitives and diagnostics, while the example demonstrates how to apply them safely. If Forge SQL behavior changes, I can update the example, documentation, or helper APIs without silently changing the semantics of user queries.

So the lifecycle strategy is: keep the ORM primitives stable, keep platform-specific behavior isolated in the driver, and keep best-practice examples executable and regularly validated. The articles explain the pattern, but the examples help ensure that the pattern remains aligned with the platform over time.

**Q:** Since you split the library into a three-package ecosystem to reduce bundle size and avoid build issues with `node-sql-parser`, what is the observed distribution of users between `core` and `extra`? Has this modularity influenced your decision on where to place new features, and has it created any 'feature parity' gaps that you now have to manage across different packages?
**A:** I do not have a precise user distribution between forge-sql-orm core and forge-sql-orm-extra, but I do have clear usage signals and direct feedback.

My own production usage is on forge-sql-orm-extra, because my projects need the advanced capabilities: Level 2 KVS caching, cache invalidation, Rovo-related functionality, and stronger SQL parsing for advanced observability flows.

At the same time, the modular split was driven by real external user feedback. A user reported that Forge lint failed because node-sql-parser contained a duplicate object property that caused an error during bundling/linting. The user did not necessarily need the advanced parser-dependent features, but because node-sql-parser was pulled into the core package, the common path was affected.

Initially, I tried to reduce the impact by moving node-sql-parser to optional dependencies and suggesting workarounds. But the better long-term solution was architectural: move the advanced cache and Rovo integrations into forge-sql-orm-extra, and keep forge-sql-orm core lightweight.

Starting from the modular split, node-sql-parser is no longer part of the core package. It is only needed in forge-sql-orm-extra, where the advanced features live. This means users who only need the @forge/sql Drizzle driver, migrations, optimistic locking, local cache, and basic query analysis can stay on core without paying the dependency or bundle-compatibility cost.

This modularity now directly guides where I place new features. Features that are broadly useful, lightweight, and part of the normal Forge SQL data-access path belong in core. Features that require @forge/kvs, Rovo, node-sql-parser, or advanced runtime behavior belong in extra. Development-time tooling such as model and migration generation belongs in the CLI.

The split has not created a major feature-parity problem because forge-sql-orm-extra extends core rather than being a separate fork. The main responsibility is package-boundary clarity: documentation, examples, release notes, and imports must make it clear which features are available in core and which require extra.

So the modular split was not only about bundle size. It was a compatibility and product-design decision based on real user feedback: keep the core safe for the majority of apps, while preserving advanced production features in an optional extension package.

**Q:** You implemented a regex-based fallback for parameter hiding in the `core` package to avoid the heavy parser dependency. In production, how do you ensure that this simpler implementation doesn't lead to 'leakage' of sensitive data into logs compared to the la more robust parsing in `extra`, and what is your testing strategy for ensuring consistency between these two different masking paths?
**A:** The regex-based parameter hiding in the core package is not intended to be a full security boundary like a DLP system or a formal SQL parser. It is a lightweight safety mechanism for diagnostic logging.

The main goal in core is to avoid logging raw customer values when performance degradation diagnostics are enabled. This path is not meant to be normal always-on query logging for every request. It is used only when a developer enables observability features such as degradation analysis, threshold-based warnings, or query-plan diagnostics.

In that context, regex-based masking is better than writing raw SQL and raw parameters into logs. It reduces the risk of accidental exposure while keeping the core package lightweight and avoiding the node-sql-parser dependency that caused Forge lint and bundle issues for some users.

For users who need stronger masking guarantees, the recommendation is to use forge-sql-orm-extra, where the heavier parser-based path is available. That package is intended for advanced production usage such as L2 caching, Rovo, and stronger SQL inspection behavior.

I would not claim that the regex fallback gives the same robustness as parser-based masking for every possible SQL shape. The trade-off is intentional: core provides lightweight best-effort protection for diagnostic logs, while extra provides the more robust path when the application needs it.

The testing strategy should focus on common and risky cases: string literals, numeric values, boolean values, dates, UUIDs, IN clauses, LIKE patterns, and parameterized queries. The same input cases can be tested against both masking paths to ensure they produce safe output for normal query shapes. But the most important operational rule is that sensitive diagnostic logging is opt-in and should be enabled only when needed.

So the short answer is: core masking is best-effort log hygiene for degradation diagnostics, not a complete security boundary. It prevents the most obvious raw-value leakage without pulling heavy dependencies into the common path. For stronger guarantees, users should use forge-sql-orm-extra or disable SQL/plan logging in sensitive environments.

**Q:** Given that Forge functions are ephemeral and have strict memory limits, does the initialization of the Drizzle driver and the loading of your entity schemas in `core` contribute significantly to the memory overhead during cold starts? Have you had to implement any lazy-loading or tree-shaking strategies for the schema definitions to prevent the ORM itself from becoming a memory bottleneck?
**A:** The Drizzle driver initialization itself has not been a meaningful memory bottleneck.

Drizzle is lightweight in this usage pattern, and the forge-sql-orm driver is effectively stateless. It does not open a persistent database connection in the traditional sense, and it does not load the full database schema from Forge SQL at runtime. The application imports the schema definitions it actually uses, and Drizzle builds SQL from those TypeScript table definitions.

Because the driver is stateless, it can be declared at module/global scope in a Forge function. In a cold start it is initialized once with the module, and in a warm Lambda/container execution it can be reused across invocations. This keeps the normal runtime path cheap.

I did not need to implement special lazy-loading for the driver itself. The more important bundle-size and memory concern was not Drizzle, but optional advanced dependencies such as node-sql-parser, Rovo-related logic, and Level 2 cache features. That is why those advanced capabilities were moved into forge-sql-orm-extra, while the core package remains focused on the common lightweight path.

For schema definitions, the strategy is also simple: schemas are normal application code. Developers control what they import. The ORM does not introspect and load the entire database schema during request execution. So tree-shaking and normal bundler behavior are usually enough, as long as the app does not import unnecessary schema modules itself.

So the short answer is: Drizzle and the custom driver are not the memory problem. The driver is stateless and reusable in warm executions, and the core package does not perform runtime full-schema loading. The main architectural work was to keep heavy optional features out of core, not to lazy-load Drizzle itself.

**Q:** You've mentioned that Atlassian has begun contributing to the project and that it serves as a discovery tool for platform edge cases. From your perspective as a Principal Developer, do you see this ORM becoming an 'official' part of the Forge SDK or being maintained as a community-driven reference implementation? How does that shift in ownership or status affect your long-term maintenance roadmap?
**A:** I would not describe forge-sql-orm as an official part of the Forge SDK today. At the moment, it is still a community-driven OSS library and reference implementation built on top of @forge/sql.

That said, my long-term hope is that Atlassian will eventually adopt the library, or at least some of its ideas, into the official Forge ecosystem. I think this would be valuable because the library solves real problems that many Forge developers face: Drizzle integration, migrations, optimistic locking, query diagnostics, caching patterns, and Forge SQL-specific developer experience.

The Atlassian contributions are an encouraging signal, but I would frame them carefully. I think part of the reason Atlassian is engaging is practical: developers may ask questions when @forge/sql and the ORM behave unexpectedly together, and the library exposes real platform edge cases. I also asked for this kind of support and contribution during Atlas Camp. When Atlassian engineers contribute fixes, it helps improve compatibility and quality for the broader Forge ecosystem.

At the same time, this does not yet change the ownership model. Until there is a formal decision, I maintain the project as an independent OSS library with a strong quality bar. Atlassian contributions are welcome, but they still need to follow the same requirements as the rest of the project: tests, compatibility, minimal breaking changes, and alignment with the architecture.

If Atlassian eventually adopts the library, the roadmap would need to become more formal. It would require stronger compatibility guarantees, platform-release coordination, official support expectations, and probably a clearer governance model. But that would also be a positive outcome, because it would mean the patterns developed in forge-sql-orm became useful enough to become part of the official Forge developer experience.

So the short answer is: today it is a community-driven OSS project with practical Atlassian collaboration. My hope is that Atlassian will eventually take ownership of it or incorporate its ideas into the official Forge SDK, but until then I maintain it independently with production users and backward compatibility in mind.

**Q:** You mentioned acting as a security researcher to uncover cross-tenant metadata leakage and restricted SQL behavior, which led to Atlassian shipping a platform hardening update. As a Principal Developer, how did you manage the communication and disclosure process with Atlassian engineering to ensure these findings were shifted from 'theoretical vulnerabilities' to 'platform priorities' without creating friction, and did this establish a formal channel for security feedback between you and the project?
**A:** I handled this as a responsible disclosure process through Atlassian’s official security channel.

The first step was to document the Forge SQL isolation behavior carefully and send the disclosure to security@atlassian.net. I described what I observed, why it mattered for tenant isolation, how database-level metadata could create unexpected cross-tenant interaction paths, and why this behavior was security-relevant for Forge SQL.

This was not only treated as a theoretical concern. Atlassian Product Security reproduced the issue on their side, accepted it as a vulnerability, and assigned it the tracking identifier VULN-1917751. That confirmation was important because it established that the finding was valid and that it should be handled through the proper security process.

Later, at Atlas Camp, I had the opportunity to meet directly with the Atlassian storage team. I demonstrated the cross-tenant behavior and we discussed possible mitigations at the platform level. That direct engineering conversation helped move the issue from a written vulnerability report into a concrete platform discussion: what Forge SQL currently allowed, which SQL behaviors should be restricted, how to preserve legitimate developer use cases, and what else should be closed to make the platform safer.

After that, the communication continued directly with Atlassian engineering. We discussed not only the specific behavior I had reported, but also adjacent areas that could be restricted for developers to reduce the risk of metadata abuse, restricted SQL behavior, and resource-exhaustion patterns.

I tried to keep the process constructive and responsible. I did not publish sensitive technical details while Atlassian was investigating and working on the hardening. My goal was not to create public pressure, but to help improve Forge SQL security for the whole ecosystem.

The result was a platform-level hardening update: Forge SQL now performs pre-execution query monitoring and rejects restricted functions, statements, optimizer hints, and SQL patterns with SQL_POLICY_VIOLATION.

I would not describe this as a formal permanent security feedback channel owned by me. The official path remained Atlassian Product Security. But it did establish a practical trust and feedback loop: I could report technically detailed findings, Atlassian could reproduce and validate them, and the storage/platform team could turn the research into concrete hardening work.

So the Principal-level contribution was not only finding the vulnerability. It was managing the disclosure responsibly, making the risk reproducible, working with both security and platform engineering, and helping move the finding from research evidence to a platform-level security improvement.

**Q:** Following the platform hardening update and the introduction of `SQL_POLICY_VIOLATION`, did you perform a comprehensive audit of the ORM's diagnostic and observability queries—specifically those used in post-mortem OOM/Timeout analysis—to ensure that the act of diagnosing a failure doesn't itself trigger a security policy violation, and what specific SQL patterns were identified as 'unsafe' by the platform that you had to avoid?
**A:** Yes, after the Forge SQL hardening update I reviewed the ORM areas that could be affected by the new SQL_POLICY_VIOLATION behavior.

The important distinction is that normal ORM usage was not affected. CRUD operations, migrations, pagination, optimistic locking, caching, regular query execution, and the normal Drizzle driver path continued to work as before.

The post-mortem OOM and timeout analysis was also not affected. That diagnostic path did not depend on the SQL pattern that Forge started rejecting in my implementation. So I did not need to redesign the OOM/Timeout post-mortem flow.

The affected area was the optional slow query log / execution plan observability feature. More specifically, the scheduled slow-query analysis job used the tidb_session_alias optimizer hint to distinguish application queries from system queries during slow query log analysis. After Atlassian introduced pre-execution SQL policy enforcement, that optimizer hint could be rejected with SQL_POLICY_VIOLATION.

So the unsafe pattern I had to remove from the ORM was not the general diagnostic approach, and not EXPLAIN-based post-mortem analysis. It was the use of a blocked optimizer hint for slow-query filtering.

I created a follow-up compatibility issue, changed the slow-query filtering logic to avoid relying on tidb_session_alias, and released the fix in forge-sql-orm 2.2.3. The goal was to make the optional observability job compatible with the new platform policy while keeping the rest of the ORM behavior unchanged.

So the audit result was: core ORM behavior was safe, OOM/Timeout post-mortem diagnostics were safe, and only the optional slow-query log analysis needed a compatibility fix because it used an optimizer hint that the new Forge SQL policy rejected.

**Q:** Since forge-sql-orm has become a practical research surface and reference implementation that influences platform behavior, do you see any inherent architectural tension between your goal of providing 'deep observability' (like execution plans and OOM diagnostics) and Atlassian's goal of as a platform provider to restrict access to database internals for security and hardening reasons? How do you balance the same tool that helps developers diagnose issues with the same tool that could be used to probe platform boundaries?
**A:** I would separate these two things.

I do not see deep observability itself as a security problem. The observability features in forge-sql-orm are designed to help developers understand their own application queries: execution time, query plans, slow queries, timeout diagnostics, and OOM-related behavior. This is necessary because Forge SQL is a managed platform and developers do not have direct database access.

The security issue I found was not caused by observability. The real problem was an isolation gap through database-level metadata. During my research, I found that some metadata behavior could create unexpected cross-tenant interaction paths. That is a different class of issue: not “developers can see too much through observability,” but “the platform exposed metadata behavior that should not have crossed tenant boundaries.”

So I would not frame this as observability versus security. Good observability should operate inside the tenant and application boundary. Platform security should ensure that metadata, system tables, restricted statements, and database internals cannot be abused to cross that boundary.

From that perspective, my ORM work and the platform hardening are aligned. The ORM gives developers practical diagnostics for their own apps. Atlassian’s hardening closes unsafe SQL and metadata paths that should not be available in a multi-tenant managed database environment.

The fact that the Forge SQL observability work was presented at Atlas Camp is also important context. It suggests that Atlassian also sees value in developer-facing diagnostics. The goal is not to remove observability, but to keep it within safe platform boundaries.

After Atlassian introduced SQL_POLICY_VIOLATION, I treated the new policy as the updated platform contract. The normal observability paths, including OOM/Timeout post-mortem diagnostics, were not affected. Only the optional slow-query log filtering needed a compatibility fix because it used an optimizer hint that the new policy blocked. I updated that logic instead of trying to bypass the restriction.

So the balance is: observability remains useful and legitimate when it helps developers diagnose their own app behavior; platform hardening is needed to prevent metadata or restricted SQL behavior from breaking tenant isolation.

**Q:** When you released version 2.2.3 to address the platform hardening impact, how did you communicate this change to your users? Specifically, did you provide guidance on how developers should handle their own custom SQL queries that might now be triggered by `SQL_POLICY_VIOLATION`, or was the focus limited strictly to the ORM's internal observability logic?
**A:** The focus of the 2.2.3 release was limited to the responsibility of forge-sql-orm itself.

I communicated the change as a Forge SQL policy compatibility release. The release notes explained that Atlassian introduced pre-execution query monitoring and the new SQL_POLICY_VIOLATION error, and that this was an important platform-level hardening update.

Then I explained the concrete impact on the library. Normal ORM usage was not affected: CRUD operations, migrations, pagination, optimistic locking, caching, and regular query execution continued to work as before. The only known affected area was the optional slow query log / execution plan observability flow, because it used a tidb_session_alias optimizer hint that the new policy could reject.

So the fix was intentionally scoped: I removed the dependency on that blocked optimizer hint and changed the ORM’s internal slow-query filtering logic to be compatible with the new Forge SQL policy.

I did not try to provide a full migration guide for every possible custom SQL query that developers might have in their own apps. I cannot know what raw SQL each application executes, and I am not Atlassian. The platform policy is defined by Atlassian, so developers who execute their own custom SQL need to check the official Forge SQL changelog and adapt their own queries if they hit SQL_POLICY_VIOLATION.

For me, this is a separation of responsibility. forge-sql-orm is not a financial or compliance framework that can guarantee every user’s custom SQL is policy-safe. My responsibility is to make sure the ORM’s own queries and documented features continue to work correctly under the updated platform contract, and to clearly communicate which part of the library was affected.

So the release guidance was focused on the ORM impact: if you use normal ORM functionality, nothing changes; if you enabled optional slow-query observability, upgrade to 2.2.3; if your own raw SQL now fails with SQL_POLICY_VIOLATION, follow Atlassian’s platform documentation because that is outside the ORM’s control.

