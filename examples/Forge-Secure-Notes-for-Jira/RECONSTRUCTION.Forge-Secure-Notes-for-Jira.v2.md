## PROJECT DESCRIPTION

Forge Secure Notes for Jira is a zero-trust security application designed to allow users to share sensitive, ephemeral information within Jira issues. It employs client-side encryption and out-of-band key exchange to ensure that plaintext data never reaches the backend, featuring automatic self-destruction of notes upon reading or expiration.

_Cybersecurity, Enterprise Collaboration, Data Privacy, Identity & Access Management (IAM) · Atlassian Forge, React, Vite, Node.js, Forge SQL, Forge KVS, Web Crypto API (AES-GCM/PBKDF2), Rovo AI, Atlassian Design System_

## Your IMPACT as Principal Developer

I architected and developed Forge Secure Notes for Jira, a zero-trust security application designed to ensure plaintext data never reaches the backend. I implemented a split-storage architecture that separates encrypted payloads in Forge KVS Secret Storage from relational metadata in Forge SQL. To define this boundary, I established a rule: any field capable of revealing or explaining the secret—such as note content or user-entered sensitive descriptions—must be encrypted client-side. Forge SQL is reserved for non-sensitive governance metadata required for auditability and lifecycle management (e.g., account IDs, timestamps, and expiration states). To maintain this boundary, I built a client-side encryption pipeline using PBKDF2 for key derivation and AES-GCM for payload encryption, refining the implementation with `crypto.getRandomValues()` for randomness and `timingSafeEqual` to mitigate timing attacks.

To ensure stability across varying tenant data sizes, I implemented an asynchronous diagnostic pattern using Forge Async Events. This allows me to monitor slow SQL query patterns and detect performance degradation in audit logs and global admin views without blocking user requests or exceeding execution limits. I used these signals as a feedback loop to refine schemas and query strategies before they became production incidents. To improve maintainability, I refactored the backend using InversifyJS for dependency injection, decoupling services from repositories.

I designed a controlled analytics layer via Rovo AI, implementing a fail-closed validation layer with a full AST-based parser. This ensures that AI-generated SQL is restricted to read-only operations on approved tables and columns, blocking any query that deviates from the allowed AST shape to prevent unauthorized metadata exposure. I further extended the application into Jira Service Management (JSM) portals, adapting the identity resolution logic to allow secure agent-to-customer communication. This ensures that external portal users are authorized via the JSM request context while maintaining the same zero-trust encryption guarantees as internal users.

To preserve the zero-trust model, I designed a manual out-of-band key exchange process. While the app generates links to Forge global pages to notify recipients of a note, these links only identify the encrypted note and enforce recipient access; they do not contain the decryption key. The key must be transferred via a separate channel (e.g., Slack or Telegram) chosen by the users. This ensures that neither the application backend nor Atlassian infrastructure possesses all the data required to reconstruct the secret. I intentionally omitted backend recovery or escrow mechanisms to avoid weakening this guarantee, treating Secure Notes as ephemeral secrets rather than long-term storage.

I developed governance tools including role-based audit log views and CSV export utilities, and integrated `@forge/realtime` for live note updates. On the operational side, I established a CI/CD pipeline via GitHub Actions with environment-specific jobs, integrated SonarQube for quality gating, and implemented Husky pre-commit hooks. Finally, I transitioned the project to the Business Source License 1.1 and authored detailed security documentation, including encryption flow UML diagrams, while managing routine maintenance of TypeScript plugins and Vite configurations.

## Recalled context (this deepen round)

One important non-code security detail is how email sharing and out-of-band key exchange were designed.

When a Secure Note is created, the app generates a unique link to a Forge global page route that opens a specific note. This link can be shown in the recipient’s Jira issue panel and can also be sent to the recipient by email as a notification or sharing message.

However, the link itself is not enough to read the secret. The link only points to the secure note page. It does not include the decryption key. Access to the page is also permission-protected: only the intended recipient is allowed to open the note. If another Jira user opens the same link, the app returns a 404-style response instead of showing the note page. This prevents link forwarding or accidental link exposure from becoming direct access to the encrypted note.

After the recipient opens the link, the application asks for the decryption key. The key must be transferred outside Jira, for example through Slack, email, Telegram, a phone call, or another separate communication channel chosen by the sender and recipient.

This separation was a core part of the zero-trust model. Jira/Forge can store and deliver the encrypted payload and metadata, and it can notify the recipient that a note exists, but it does not store or deliver the decryption key together with the note link. The backend cannot decrypt the note by itself.

The important security distinction is that the Jira/global-page link and the decryption key are separate. The link identifies the encrypted note and enforces recipient access. The key is exchanged out-of-band. Only a recipient who both has access to the note page and receives the key through a separate channel can decrypt the note.

This also means the email feature was not designed to send the secret directly through Jira. It was designed to notify the recipient and guide them to the secure note page, while keeping the actual decryption key outside the Jira/Forge backend trust boundary.

## Technologies

Atlassian Forge, TypeScript, React, Web Crypto API, Forge SQL

## Impact bullet points (Role Narrative)

- I architected a zero-trust security boundary using client-side AES-GCM and PBKDF2 encryption, implementing a split-storage strategy that isolated encrypted payloads in Forge KVS Secret Storage from relational governance metadata in Forge SQL to ensure plaintext never reached the backend.
- I designed a controlled AI analytics layer via Rovo AI, building a fail-closed validation parser using AST-based structural analysis to restrict LLM-generated SQL to read-only operations on allowlisted tables and columns, preventing unauthorized metadata exposure.
- I implemented an asynchronous diagnostic pattern using Forge Async Events to monitor slow SQL query patterns out-of-band, creating a performance feedback loop to refine schemas and query strategies without blocking user requests or exceeding execution limits.
- I extended the application's identity resolution logic to support Jira Service Management portals, adapting the authorization flow to verify external portal users via request context while maintaining strict zero-trust encryption guarantees for agent-to-customer communication.

## CV bullets

- Architected a zero-trust system boundary using client-side AES-GCM/PBKDF2 and split-storage to isolate encrypted payloads from relational metadata.
- Designed a fail-closed AI analytics layer via Rovo AI, implementing an AST-based validation parser to restrict LLM-generated SQL queries.
- Implemented an asynchronous diagnostic pattern using Forge Async Events to monitor SQL performance out-of-band without impacting user latency.
- Extended identity resolution logic to Jira Service Management portals, enabling secure agent-to-customer communication while maintaining zero-trust encryption.

## Possible questions

**Q:** When defining the split-storage boundary between Forge KVS and Forge SQL, what specific criteria did you use to determine which data points qualified as non-sensitive metadata for auditability versus encrypted payloads, and how did you validate that this metadata doesn't inadvertently leak sensitive context?
**A:** The split-storage boundary was based on two different goals: protecting the secret payload and keeping enough metadata for auditability, lifecycle management, and controlled analytics.

For the encrypted payload, I used Forge KVS Secret Storage because this is the Atlassian-recommended storage layer for secret application data. This also aligned with Atlassian’s broader cloud encryption model, including customer-managed encryption options such as BYOK/CMK, where enterprise customers can control or manage encryption keys for Atlassian Cloud data at rest.

However, I did not treat infrastructure-level encryption as enough for the zero-trust model. BYOK or CMK can protect data at rest inside Atlassian Cloud, but the application still needs its own security boundary. For Secure Notes, the stronger boundary was client-side encryption: the secret note content was encrypted before it reached the backend, so the backend never received the plaintext secret.

The rule for deciding what belongs in the encrypted payload was: if a field can reveal the secret, explain the secret, or give meaningful sensitive context without the decryption key, it must be encrypted. This includes the note content and any user-entered sensitive text.

Forge SQL was used for metadata, not for the secret itself. The metadata was needed for audit, global admin pages, Rovo analytics, access control, expiration, cleanup, and lifecycle management. Examples of metadata include note identifiers, Jira issue or request references, owner and recipient account IDs, timestamps, expiration state, status flags, audit events, and references to encrypted payload records.

The key validation rule was: SQL metadata can describe the existence, ownership, lifecycle, and permission state of a note, but it must not describe the sensitive meaning of the note. For example, an issue ID, recipient ID, expiration timestamp, or audit event is acceptable metadata. But a plaintext title like “production database password” or any user-entered secret description would be considered sensitive and should stay in the encrypted payload.

To validate this boundary, I reviewed DTOs, repositories, audit views, CSV exports, global pages, and Rovo-facing analytics data to make sure they did not expose the note content or sensitive user-entered context. Audit and Rovo were allowed to work with governance metadata, but not with the encrypted secret payload itself.

So the design was not simply “KVS for data and SQL for indexes.” It was a layered zero-trust model: Forge KVS Secret Storage stored encrypted secret payloads, Atlassian infrastructure encryption provided platform-level protection, and Forge SQL stored only the minimum metadata required for permissions, auditability, lifecycle, and analytics without exposing the secret meaning.

**Q:** Regarding the Rovo AI AST validation layer: how does the parser handle edge cases or unsupported SQL syntax generated by the LLM—does it default to a 'fail-closed' state (rejecting the query entirely), and have you performed any adversarial testing to ensure the AI cannot bypass these constraints via SQL injection or complex joins?
**A:** The Rovo AI SQL validation layer was designed to fail closed. I did not treat LLM-generated SQL as trusted input. If the generated query used unsupported syntax, unexpected tables, restricted columns, unsafe joins, or anything that the parser could not validate safely, the query was blocked.

In that case, the client received an empty response instead of executing the query. This was intentional. A dynamic AI-generated query could accidentally or intentionally request metadata that should not be visible to a normal user. For example, a regular note user should not be able to query who sent notes to other users or who received notes from other users. That kind of metadata is useful for admin audit, but it should not be exposed to every user.

The validator enforced a narrow access model. A normal user could see only notes created by them or notes sent to them. Admin-level audit views could access broader governance metadata, but regular Rovo queries had to stay within the user’s allowed scope.

The safety model was based on allowlisting rather than blacklisting. The parser allowed only the expected read-only query shapes, approved tables, approved columns, and access conditions. If the AI generated something outside that expected AST shape, the system rejected it instead of trying to “fix” or partially execute it.

I also considered prompt injection and SQL injection-style attempts as part of the threat model. The AI prompt itself was not treated as a security boundary. The real security boundary was structural validation of the generated SQL plus row-level access rules. This ensured that even if the AI generated a risky query, the backend would not execute it unless it matched the allowed access model.

**Q:** Now that you have established asynchronous observability for slow SQL queries, what is your process for translating these diagnostic signals into architectural refinements, and have you identified any systemic bottlenecks in Forge SQL's performance that necessitated this out-of-band monitoring?
**A:** The main goal of asynchronous SQL observability was to detect degrading query patterns before they became visible customer problems.

In Forge SQL, different tenants can have very different data sizes. One customer may have only a few secure notes, while another customer may eventually have hundreds of thousands or even millions of records. A resolver that works fine for a small tenant can slowly degrade as the dataset grows. That is why I wanted observability at the resolver/query level, not only generic error logging.

The process was: detect slow or degrading SQL behavior, capture deterministic query diagnostics, and then use that signal to decide whether the architecture needed an index change, query rewrite, pagination change, reduced polling, or moving work out of the synchronous user flow.

I used an out-of-band approach because diagnostics should not make the user request slower. Forge apps have strict execution limits, and slow-query analysis can itself be expensive. By using Forge Async Events and delayed diagnostic processing, the user-facing flow could remain fast while the application still collected useful performance signals.

One important bottleneck was that SQL performance is tenant-size dependent. The same query can look harmless during development or for a small installation, but become expensive when the table grows. This is especially important for audit logs, analytics, cleanup logic, and global admin views, because those features naturally grow over time.

The observability strategy also helped with post-mortem diagnostics for severe cases like timeout or out-of-memory errors. Instead of re-running a dangerous query, the system could capture metadata about the actual execution while it was still fresh. This is safer because re-executing the same query could trigger the same timeout or OOM again, and it also avoids exposing sensitive bind parameters or tenant data.

So the observability loop was not just logging. It was a feedback loop: detect degradation, identify the query pattern, understand whether the issue is data growth, missing indexes, bad filtering, or resolver design, and then refine the schema, query, or execution strategy before the problem becomes a production incident.

**Q:** By extending the application into Jira Service Management portals, you've introduced users who may exist outside the primary organizational boundary; how did you adapt the identity and key-exchange flow to ensure that external portal users maintain the same zero-trust guarantees as internal Jira users?
**A:** For JSM portal support, the important scenario was not only an external user sending a secret to an agent. A key requirement was the opposite direction: an internal agent should be able to send a secure note to an external portal user.

Because of that, I treated JSM portal users as a separate identity and permission context. An external user could not access a secure note only because they had a link. The external user had to be authorized in the JSM portal and associated with the relevant request context.

The zero-trust encryption boundary stayed the same. The note content was still encrypted on the client side, and the backend did not receive the plaintext secret or the decryption key. Forge storage kept the encrypted payload, while Forge SQL stored only metadata needed for access control, lifecycle, audit, and request mapping.

The main adaptation was around identity and access resolution. For internal Jira users, the app could rely on the Jira issue context. For JSM portal users, the app had to resolve the portal request context and verify that the external user was allowed to access that request before showing or allowing the secure note flow.

This was important because an agent may need to send sensitive information to a customer, but the customer should only be able to access it after proper portal authentication. The sharing flow therefore had to preserve two guarantees: the secret remains encrypted and outside backend control, and the recipient is an authorized portal user for the relevant JSM request.

So JSM support changed the identity and delivery model, but not the zero-trust model. It allowed agent-to-external-user secret sharing while still requiring portal authorization and keeping the encrypted payload protected from the backend.

**Q:** Given the high friction of requiring users to manually exchange keys via separate channels like Slack or Telegram, what was the internal debate regarding usability versus security? Did you evaluate any 'semi-automated' key exchange mechanisms, and what specific threat model drove the decision to keep this process entirely manual and out-of-band?
**A:** The usability versus security trade-off was very explicit. Manual key exchange creates friction, but for this product it was an intentional security requirement.

The application runs on Atlassian infrastructure. Because of that, if the decryption key were stored, delivered, or automatically exchanged through the same Jira/Forge application flow, then the app backend or Atlassian infrastructure could potentially have enough information to reconstruct the secret. That would break the zero-trust promise.

The core zero-trust requirement was that neither the application backend nor Atlassian should have all the data required to decrypt the note. Atlassian/Forge can host the encrypted payload and the metadata. The app can enforce recipient access to the note page. But the decryption key must stay outside that trust boundary.

That is why the key exchange was kept manual and out-of-band. The note link identifies the encrypted note and enforces that only the intended recipient can open the note page. But the key is transferred separately through another channel such as Slack, Telegram, email, phone, or another communication method chosen by the users.

I did consider the usability cost. A semi-automated key exchange would be easier for users, but most convenient options would put the key back into the same infrastructure boundary as the encrypted payload. For example, embedding the key into the Jira link, storing it in Forge storage, or sending it automatically through the app would make the system easier to use but would weaken or destroy the zero-trust model.

So the threat model was simple: a compromise or privileged access inside the Jira/Forge application boundary should not be enough to decrypt user secrets. To read a note, an attacker would need both access to the authorized note page and the decryption key from a separate channel. This separation is what preserved the zero-trust guarantee, even though it made the user flow less convenient.

**Q:** How does the system handle the lifecycle of access permissions when a recipient's organizational role changes? Specifically, if a user is revoked from Jira but still possesses the out-of-band key, how is the '404-style' protection enforced at the Forge platform level to ensure that the possession of the key alone is insufficient for decryption?
**A:** Possession of the out-of-band key alone is not enough to decrypt a note, because the key is only one part of the access model.

To access the encrypted note, the recipient must still have access to Jira and to the Forge app running inside the Atlassian tenant. If the user is revoked from Jira or no longer has access to the tenant, they cannot open the Forge global page or call the app resolvers. This tenant and identity boundary is enforced by Atlassian and by the Runs on Atlassian execution model.

So even if a former recipient still has the decryption key, they cannot use it unless they can also access the encrypted payload through the authorized Jira/Forge context. The app does not expose the encrypted note payload to unauthenticated or unauthorized users.

The 404-style protection is enforced before the decryption step. When the user opens the note link, the app checks the current Atlassian identity and the note metadata. If the user is not the intended recipient, no longer has access, or the note is not available anymore, the app behaves as if the note does not exist and does not return the encrypted payload.

This means the security model has two gates: Atlassian/Jira access to the app and note page, and possession of the out-of-band decryption key. Losing Jira access breaks the first gate, so the key alone is insufficient.

**Q:** Since the application triggers email notifications to guide recipients to the secure note page, how did you mitigate the risk of phishing or link-spoofing? Did you implement any verification mechanisms within the global page—beyond simple identity checks—to ensure the user knows they are interacting with a legitimate note before they are prompted for the out-of-band key?
**A:** Since the application triggers email notifications to guide recipients to the secure note page, how did you mitigate the risk of phishing or link-spoofing? Did you implement any verification mechanisms within the global page—beyond simple identity checks—to ensure the user knows they
 are interacting with a legitimate note before they are prompted for the out-of-band key?

**Q:** In a strict zero-trust implementation where keys are exchanged out-of-band and not stored on the backend, how do you handle 'lost key' scenarios? Did you implement any recovery mechanisms (e.g., multi-sig or escrow), or was the architectural decision to accept permanent data loss as a trade-off for total privacy?
**A:** Lost-key recovery was intentionally not a primary requirement because Secure Notes were designed as temporary, ephemeral secrets, not as long-term encrypted storage.

Every note had a lifecycle: it could expire by TTL, and note links were one-time-use. After the recipient opened the note, the link was burned and the note was no longer available. If the note expired before being read, the recipient received an email notification that the secure note link had expired, and the expiration event was recorded in the audit log.

Because of this lifecycle model, I did not implement backend recovery, escrow, multi-sig, or admin recovery. Any recovery mechanism that allows the backend, Atlassian, or an administrator to reconstruct the secret would weaken the zero-trust guarantee. The core rule was that neither the application backend nor Atlassian should have enough material to decrypt the note.

The product still preserved governance and auditability without recovering the secret body. During note creation, the sender could provide a short non-secret description of what the note was about. This description, together with Jira context such as the issue, project, sender, recipient, timestamps, TTL, read/expired status, and audit events, became the governance and audit data.

So if a key was lost, the secret content could not be recovered. The intended fallback was to create a new secure note. However, the organization still had an audit trail showing that a note existed, who sent it, who it was intended for, what Jira issue or project it related to, whether it was read or expired, and when the lifecycle event happened.

This was an intentional privacy-over-recoverability trade-off. Secure Notes were not designed to be a recoverable vault. They were designed for short-lived secret exchange where permanent backend recovery would contradict the zero-trust model.

