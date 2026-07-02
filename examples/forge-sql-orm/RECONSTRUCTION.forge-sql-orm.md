## PROJECT DESCRIPTION

Forge SQL ORM is a TypeScript library that connects Atlassian Forge’s @forge/sql storage with the Drizzle ORM, providing a type‑safe, migration‑enabled, and performance‑aware database layer for Forge apps. It supplies a custom Drizzle driver, local in‑memory caching (Level 1), optional global KVS caching and Rovo analytics (Level 2), optimistic locking, vector/binary types, and an extensive query analysis framework that logs timeouts, OOM errors, and execution plans.

_Atlassian Forge platform, SQL database access, TypeScript ORM development, AI embeddings & similarity search, Caching & performance monitoring · TypeScript, Node.js, Drizzle ORM, @forge/sql, TiDB (Atlassian managed SQL), Level‑1 in‑memory cache, @forge/kvs (global KVS), Rovo analytics, npm, GitHub Actions CI, SonarCloud, DeepScan, Codacy, Snyk, REUSE compliance_

## Your IMPACT as Principal Developer

I architected and implemented Forge SQL ORM, a TypeScript library that bridges Atlassian Forge’s @forge/sql storage with Drizzle ORM. I designed the core architecture by implementing a custom Drizzle driver to replace MySQL2 and split the library into modular packages—core, CLI, and extra—to minimize client bundle sizes. To ensure data consistency in concurrent environments, I implemented optimistic locking by integrating version columns across entity schemas and updating CRUD logic to prevent lost-update races. I expanded the ORM's capabilities by adding support for TiDB binary types (BINARY, VARBINARY, BLOB) and creating a custom `vectorFloat32` type for AI embeddings and similarity search, supported by typed SQL function helpers for Cast, Date, Numeric, and Vector operations.

To optimize performance within Forge's ephemeral execution environment, I designed a two-level caching strategy. Level 1 is an invocation-scoped in-memory cache that eliminates duplicate reads within a single resolver execution. Level 2 is a persistent global cache backed by @forge/kvs, acting as a virtual materialized view for expensive read-heavy queries across invocations. I implemented cache coherence through automatic invalidation on writes, where the ORM tracks affected tables and evicts related L2 entries, optionally using a cache context to consolidate invalidations at the end of a resolver execution.

I developed a query analysis framework to address the difficulty of diagnosing SQL timeouts and OOM errors in Forge. I moved from relying on unstable platform summary data to a deterministic 'TopSlowest' mode that records SQL digests and timing within the resolver. For catastrophic failures, I implemented immediate post-mortem diagnostics that capture execution plans at the moment of failure without re-running the dangerous query. This framework integrates with EXPLAIN ANALYZE to identify inefficient joins or table scans and includes a PerformanceMonitor for tracking memory usage and latency thresholds.

To support dynamic SQL—particularly for AI agents like Rovo—I implemented a guarded execution pattern for Row-Level Security (RLS). Since Forge SQL lacks native per-user session RLS, I built a multi-layer validation pipeline: a static AST pre-check to ensure queries are read-only and single-table, an EXPLAIN-based verification of the execution plan, and a post-execution metadata check to prevent cross-table leakage. This allows the safe injection of application context (e.g., user IDs or project keys) into dynamic queries.

I built a schema management pipeline featuring an idempotent migration engine with deterministic ordering and CLI tooling for entity generation. I added web triggers for applying migrations, flushing caches, and fetching schemas. To demonstrate these capabilities, I developed example projects including a hybrid search pipeline fusing TiDB VECTOR similarity with full-text scoring via Reciprocal Rank Fusion.

On the infrastructure side, I configured CI/CD pipelines to automate weekly snapshot publishing to GitHub Packages and enforced security standards using Codacy, Snyk, and REUSE headers. I hardened the supply chain by pinning third-party GitHub Actions to specific commit SHAs and implemented automated dependency management. I maintained code quality through unit testing of AST parsing logic, cache handlers, and migration utilities.

## Technologies

TypeScript, Drizzle ORM, Atlassian Forge, TiDB, Node.js

## Impact bullet points (Role Narrative)

- I architected and implemented Forge SQL ORM, designing a custom Drizzle driver for @forge/sql and a modular package structure (core, CLI, extra) to minimize client bundle sizes in ephemeral environments.
- I designed a two-level caching architecture consisting of an invocation-scoped L1 in-memory cache to eliminate duplicate reads within a single resolver and a persistent L2 global cache using @forge/kvs for expensive read-heavy queries, implementing automatic invalidation based on table dependencies.
- I developed a query analysis framework that replaced unstable platform summary data with a deterministic 'TopSlowest' mode and immediate post-mortem diagnostics to capture execution plans during SQL timeouts or OOM errors without re-running the failing query.
- I implemented a guarded execution pattern for dynamic SQL to enable safe AI-generated queries, utilizing a multi-layer validation pipeline comprising a static AST pre-check, EXPLAIN-based plan verification, and post-execution metadata checks to enforce row-level security.

## CV bullets

- Architected Forge SQL ORM by designing a custom Drizzle driver and modular package system to minimize client bundle sizes.
- Designed a two-level caching strategy using invocation-scoped L1 memory and global L2 KVS with table-based automatic invalidation.
- Developed a query analysis framework featuring deterministic 'TopSlowest' tracking and immediate post-mortem diagnostics for SQL timeouts and OOM errors.
- Implemented a guarded execution pipeline for dynamic SQL using AST parsing and EXPLAIN-based verification to enforce row-level security.

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

