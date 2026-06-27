## PROJECT DESCRIPTION

A modular Java-based plugin that embeds a RADIUS server inside Keycloak, enabling Keycloak’s authentication and authorization to be used for RADIUS clients. It supports standard RADIUS, RadSec (RADIUS over TLS), CoA, OTP, WebAuthn, VPN protocols, and integrates with various hotspot vendors (Mikrotik, Cisco, Chillispot). The project includes CI/CD pipelines, Docker images, extensive examples in Node.js, and continuous compatibility updates across Keycloak releases 9.x–26.4.0.

_Identity & Access Management, Network Authentication (RADIUS/RadSec), VPN Integration (PPTP/L2TP/IPSec), Hotspot / ISP authentication, Multi-factor authentication (OTP, WebAuthn), DevOps / CI/CD · Java (JDK 21+), Maven, Netty, Keycloak Quarkus, Docker (AMD64 & ARM), CircleCI, GitHub Actions, Node.js (examples), LDAP/OpenLDAP, FreeRADIUS dictionary format, RadSec / TLS, CoA (Change of Authorization), Mikrotik/Cisco/Chillispot plugins_

## Your IMPACT as Staff Developer

I designed and implemented a modular Java-based RADIUS server plugin for Keycloak, intended as a native alternative to standalone servers like FreeRADIUS by embedding authentication and authorization directly within the identity provider. I established clear architectural boundaries between configuration, dictionary provisioning, codec logic, and handler implementations. To ensure secure transport, I implemented RadSec (RADIUS over TLS), providing an encrypted trust boundary for VPN protocols such as PPTP, L2TP, and IPSec. I developed a modular vendor-specific extension model using an SPI-based provider factory; this allowed me to implement Mikrotik support based on my own direct validation while enabling community contributors to add support for other vendors, such as Cisco and ChilliSpot, without modifying the core integration layer.

To extend Keycloak's capabilities into the network domain, I implemented RADIUS Change-of-Authorization (CoA) support and a session management system that maps user attributes to active sessions, enabling precise session termination via Disconnect-Requests. I built a dynamic attribute mapping engine allowing administrators to conditionally include or reject RADIUS attributes based on runtime criteria like user roles or group membership. To integrate MFA, I implemented an OTP injection flow using an OTPProtocolMapper and refined password verification logic to support both dual-verification and OTP-only modes, specifically resolving non-standard request behaviors observed in Mikrotik WinBox during my own testing. I also introduced realm-qualified username support (@realm) to scope lookups across multiple Keycloak realms.

I prototyped a bridge between legacy RADIUS and modern authentication by implementing an identity translation layer. Since the RADIUS protocol is password-centric, I designed a flow where users first authenticated via Keycloak using modern methods—such as WebAuthn or YubiKey—after which the system issued a RADIUS-compatible credential. This allowed legacy network devices to indirectly benefit from modern IAM flows without requiring the RADIUS protocol itself to support challenge-response hardware keys.

On the infrastructure side, I built a CI/CD pipeline using CircleCI and GitHub Actions to manage multi-architecture Docker images (AMD64). My primary driver was keeping the plugin aligned with the latest secure Keycloak versions rather than maintaining long-term backward compatibility. This required continuous migration efforts to adapt to Keycloak's architectural changes and SPI API redesigns, transitioning from WildFly to Quarkus distributions as the platform evolved. I resolved critical runtime issues, including thread leaks in Netty by refactoring NioEventLoopGroup instances into static shared fields and fixing StackOverflowErrors within the RadSecCodec. To improve deployability, I transitioned the plugin to environment-variable driven configuration (RADIUS_CONFIG_PATH, KEYCLOAK_PATH) and migrated logging from legacy Log4j to Log4J 2.x.

I maintained a testing suite with approximately 90% code coverage covering PAP/MSCHAPv2 protocols and cluster-aware scheduled tasks to ensure stability during frequent Keycloak upgrades. I also developed integration examples using Node.js and Docker Compose—including an LDAP+OTP setup with OpenLDAP—to demonstrate deployment scenarios. To support the open-source nature of the project, I managed a full release flow including Maven artifact publishing, versioned Docker images, and automated release notes tied to specific Keycloak baselines. Routine maintenance included continuous dependency alignment with Quarkus-based releases, the removal of JCenter for security compliance, and the standardization of build scripts.

## Recalled context (this deepen round)

The project was an open-source project, and over time it received visible community adoption. I do not have telemetry for all real-world deployments, but the repository had GitHub stars, issues, pull requests, and community contributions. This was important because it showed that the plugin was useful outside of my own environment, even though I could not directly validate every deployment or vendor device myself.

The release and distribution process was also an important part of the project. I maintained the build and release flow so that the plugin could be published and consumed as real artifacts, not just source code. This included Maven artifact publishing, Docker image publishing, version alignment with Keycloak releases, CI/CD pipelines, and release scripts. A big part of the work was keeping the plugin, Docker images, documentation, and examples consistent with the currently supported Keycloak version.

My own real-world validation was mainly based on Mikrotik and my personal infrastructure. I used the plugin in my own Hetzner/Mikrotik environment to validate practical RADIUS, VPN, OTP, and network authentication scenarios. This helped me discover and fix real device-specific behavior, such as the Mikrotik WinBox issue where authentication requests behaved differently from the normal flow.

Other vendor integrations, such as Cisco and ChilliSpot, were not directly validated by me on physical hardware. Those were community-driven contributions. My role there was to keep the core architecture extensible, review the integration boundary, ensure the vendor-specific logic stayed separated from the core RADIUS/Keycloak logic, and rely on the open-source feedback loop through issues and pull requests.

The project also included experimental or demonstration work around modern authentication methods, including WebAuthn and YubiKey-style flows. This was important as a proof that legacy RADIUS-based network authentication could be connected with modern IAM concepts. I would not describe every demo as a production feature, but it showed the direction of the project: bridging old network protocols with modern Keycloak-based identity, MFA, and passwordless authentication ideas.

Overall, the non-code context is that this was not just a protocol plugin. It became an open-source identity/network-authentication project with real release management, community feedback, Mikrotik-based real-world validation, vendor extension points, and experiments showing how RADIUS could be connected to modern SSO, OTP, WebAuthn, and hardware-key authentication flows.

## Technologies

Java, Keycloak Quarkus, Netty, Docker, RADIUS

## Impact bullet points (Role Narrative)

- I designed and implemented a modular Java-based RADIUS server embedded within Keycloak, establishing an SPI-based provider factory to decouple core protocol logic from vendor-specific dictionaries and handlers; this architecture allowed me to implement Mikrotik support via direct hardware validation while enabling community contributions for Cisco and ChilliSpot without modifying the core integration layer.
- I extended network authentication capabilities by implementing RadSec (RADIUS over TLS) to secure VPN transport (PPTP, L2TP, IPSec) and developed a session management system with Change-of-Authorization (CoA) support, enabling precise, real-time session termination via Disconnect-Requests based on Keycloak user attributes.
- I implemented an OTP injection flow using an OTPProtocolMapper and a dynamic attribute mapping engine to enforce conditional MFA and role-based attribute delivery; additionally, I prototyped an identity translation layer that bridged modern WebAuthn/YubiKey flows with legacy RADIUS by issuing compatible credentials after successful browser-based authentication in Keycloak.
- I built a CI/CD pipeline using CircleCI and GitHub Actions for multi-arch Docker images and maintained continuous compatibility across Keycloak versions 9.x through 26.4.0, resolving critical Netty runtime issues including thread leaks from NioEventLoopGroup instances and StackOverflowErrors within the RadSecCodec.

## Possible questions

**Q:** Given the extensive effort to maintain compatibility from Keycloak 9.x through 26.4.0, what are the primary business or customer drivers necessitating this wide version support, and how do you prioritize feature parity versus legacy stability across these releases?
**A:** My main goal was not long-term backward compatibility with old Keycloak versions. The main goal was to keep the plugin aligned with the latest Keycloak version.

Keycloak is an identity and security product, and old versions often receive security fixes or architectural changes. Because of that, I did not want the plugin to stay tied to outdated Keycloak versions for a long time. When a new Keycloak version was released, I usually migrated the plugin to that version as soon as possible.

Sometimes this was only a version update, but sometimes it required real code changes, especially when Keycloak changed or redesigned its SPI APIs. In the early stages, I supported both Keycloak WildFly and Keycloak Quarkus distributions, because both existed during the transition period. Later, when Keycloak deprecated the WildFly distribution, the project naturally moved to Quarkus-only support for newer versions.

So I would not describe the strategy as “support every old version forever.” It was more about keeping the plugin compatible with the current Keycloak platform and adapting quickly when Keycloak changed. Feature parity was mainly focused on the newest supported Keycloak version. The expectation was that all important features should work on the latest Keycloak version, and I used a strong automated test suite, with around 90% code coverage, to make upgrades safer.

In short, the driver was not legacy customer support. The driver was staying close to the latest secure Keycloak version, adapting to Keycloak platform changes, and making sure the plugin continued to work correctly after each upgrade.

**Q:** From an architectural standpoint, do you view this embedded RADIUS server as a full replacement for standalone servers like FreeRADIUS in production, or is it intended to operate within a specific security boundary (e.g., behind a load balancer or proxy) to mitigate the risks associated with embedding a network server inside the IAM provider?
**A:** The project was designed as a Keycloak-native alternative to FreeRADIUS, not just as a small integration helper. The main idea was to bring RADIUS authentication into the same identity system where the organization already manages users, realms, clients, SSO, LDAP/Kerberos integration, and OTP/MFA flows.

In Keycloak, a realm can represent an organization, and inside that realm different clients can represent internal company products. One of those clients could be a RADIUS client. That means RADIUS authentication could use the same user base, the same identity model, and, if configured, the same external identity sources such as LDAP or Kerberos. This was one of the main architectural reasons for embedding RADIUS into Keycloak: it reduced the need to maintain a separate authentication system disconnected from SSO.

The plugin also supported a RADIUS proxy mode, so it could proxy requests to FreeRADIUS when needed. This allowed it to work both as a replacement and as a bridge for environments that still had an existing FreeRADIUS setup.

Another important part was OTP and SSO integration. During user registration or setup, the user could define a RADIUS password, which was stored as a separate secret inside Keycloak storage and visible as its own credential type in the Keycloak web interface. The login flow could also require OTP, so the user could configure RADIUS OTP in Keycloak and then use the generated OTP from the network device side. The same OTP mechanism could also be reused as a second factor for SSO login.

From a security perspective, I did not think it was safe to expose a plain RADIUS endpoint publicly without additional protection. For public or sensitive network scenarios, RadSec was the recommended approach. RadSec uses TLS with certificates, effectively giving a two-way SSL style trust boundary between the RADIUS client and the server. Without RadSec, I would recommend keeping the endpoint private: reachable only inside the local network, protected by firewall rules, and accessible only from trusted NAS/VPN/network devices.

So architecturally, I viewed it as a production-capable FreeRADIUS alternative when deployed with the right network boundary. It was not meant to be an unprotected public endpoint. The intended model was: Keycloak owns identity, users, realms, clients, SSO, and OTP; the plugin adds RADIUS and RadSec capabilities on top of that; and the deployment must use either RadSec with certificates or a restricted private network boundary.

**Q:** With the introduction of the SPI-based provider factory and modular vendor plugins, what is your vision for the plugin's extensibility—are you designing this to eventually support a community or partner ecosystem where external vendors can provide their own dictionary/handler modules?
**A:** The SPI-based provider factory was mainly a natural architectural choice because this is how extensions are built inside Keycloak. I wanted the RADIUS plugin to follow the Keycloak extension model instead of hardcoding everything into one implementation.

The immediate goal was not to build a formal partner ecosystem. The first practical driver was my own use case: I needed Mikrotik support. Because RADIUS devices often require vendor-specific dictionaries and behavior, I decided to separate vendor-specific logic from the core RADIUS/Keycloak integration.

The model was simple: the core plugin provides the RADIUS server, Keycloak integration, authentication flow, and common abstractions. Vendor-specific modules provide the dictionary, describe which devices they support, define where the dictionary is loaded from, and add any required custom behavior through an interface.

This design later made it possible for other people to add support for devices I had never personally used. For example, Cisco and ChilliSpot support were added by the community for their own needs. I did not have those devices myself, so the modular architecture was important: contributors could add a vendor module without rewriting the core RADIUS server or changing the Keycloak integration layer.

So I would not describe the original goal as a planned commercial partner ecosystem. It was more a clean Keycloak-style extension boundary that solved my Mikrotik use case first and then naturally allowed community-driven vendor integrations.

**Q:** Since you've resolved highly specific runtime issues for hardware like Mikrotik WinBox, could you describe your validation environment—do you maintain a physical hardware lab for these vendors, or are these refinements driven by telemetry and reports from production deployments?
**A:** I did not maintain a full physical hardware lab for all supported vendors. Mikrotik was my main real-world use case, so most of my direct validation was focused on Mikrotik devices and Mikrotik-specific flows.

The WinBox issue was something I observed myself while testing Mikrotik authentication. As I remember, WinBox had a non-standard or at least unexpected RADIUS behavior where requests could be duplicated or handled differently from the normal flow. I investigated that behavior directly and adjusted the implementation to handle it correctly.

For other vendors, such as Cisco and ChilliSpot, I did not personally have the hardware and did not directly test those devices myself. Those integrations were added by the community for their own use cases. The vendor-specific extension model made this possible: contributors could provide a dictionary, describe which devices it applied to, define where the dictionary came from, and add any required customizations without changing the core RADIUS/Keycloak logic.

So vendor-specific validation was a mix. Mikrotik was validated through my own testing and direct usage. Cisco, ChilliSpot, and other vendor-specific refinements were driven by community contributions, issue reports, pull requests, and the practical signal that there were no follow-up complaints that the integration did not work.

I would be careful not to claim that I personally validated every vendor device. My direct validation was primarily Mikrotik. For other devices, the project relied on the open-source feedback loop: community users added support for their environments, and issues or pull requests were used to refine the behavior when problems appeared.

**Q:** As you managed the distribution of real artifacts (Maven/Docker) across nearly a decade of Keycloak versions, how did you handle the communication of breaking changes or migration paths for community users when a Keycloak upgrade required a corresponding plugin update?
**A:** I handled communication mainly through GitHub tags, GitHub Releases, and release notes. For every release, I created a tag and published a release description explaining what changed.

The release process was automated with scripts. I maintained a file with the next plugin version and the change notes for that release. When I created a new release, the script automatically loaded that file and inserted the content into the release template, so the release notes were generated consistently.

The release process also produced real distribution artifacts. I published versioned artifacts to Maven Central, created a ZIP archive with a preconfigured Keycloak distribution that included my keycloak-radius-plugin modules from Maven, and then produced a Docker image with Keycloak and the configured plugin included.

When Keycloak changed its internal APIs or SPI interfaces, the release notes explained that the latest supported version was now aligned with the current Keycloak version. I did not try to maintain every old Keycloak version forever. The main communication model was: each plugin release is tied to a specific supported Keycloak baseline, and users should upgrade the plugin together with Keycloak when the Keycloak platform changes.

**Q:** When you discovered device-specific behaviors in your Mikrotik environment—such as the WinBox authentication quirks—did you implement specific regression tests within your 90% coverage suite to simulate these hardware anomalies, or did those remain as manually validated scenarios?
**A:** For code changes, I tried to cover the new logic with automated tests. The CI pipeline did not allow a pull request to pass if coverage for new code dropped below 85%, so when the Mikrotik/WinBox behavior required code changes, I added tests for the new logic that supported that login flow.

However, I would not claim that the test suite fully simulated the physical Mikrotik device or the exact WinBox runtime behavior. The WinBox scenario was still manually validated on the real device because the issue was related to how the device behaved during authentication, including duplicated or unusual RADIUS requests.

So the validation model was mixed. The internal logic added to support WinBox login was covered by automated tests and protected by CI coverage gates. But the complete device-specific behavior still required manual testing against my Mikrotik environment. Automated tests reduced the risk of breaking the code path, but they did not replace real hardware validation.

**Q:** Regarding your WebAuthn and YubiKey demonstrations: since standard RADIUS is traditionally password-centric, what architectural 'trick' or flow did you use to bridge these modern, challenge-response hardware keys with the legacy RADIUS protocol?
**A:** The main architectural idea was not to make the RADIUS protocol itself understand WebAuthn or YubiKey. Standard RADIUS is still password-centric, so the trick was to move the modern authentication step into the browser and into the Keycloak authentication flow.

The user first authenticated through Keycloak using a modern flow: WebAuthn, YubiKey, OTP, Google, Facebook, another identity provider, or any custom Keycloak authentication flow with second or third factors. After that successful browser-based authentication, the system generated or issued a special RADIUS credential/password that could then be used by the legacy RADIUS client.

So the bridge was: modern authentication happened in Keycloak, and the output of that trusted flow became a RADIUS-compatible credential.

This made the design flexible. It was not limited only to WebAuthn or YubiKey. Any identity provider or authentication flow supported by Keycloak could be used before generating the RADIUS credential. That allowed legacy RADIUS-based devices to indirectly benefit from modern IAM features, even though the RADIUS protocol itself did not support challenge-response hardware keys directly.

I would describe it as an identity translation layer: Keycloak handled the modern authentication ceremony, and the plugin converted the result into something that a traditional RADIUS server and RADIUS client could use.

**Q:** When reviewing community contributions for vendors you didn't personally own (like Cisco), what was your process for validating that their logic didn't introduce regressions into the core RADIUS server without having the physical hardware to test against?
**A:** For vendor modules that I did not personally own, such as Cisco, I did not validate the behavior on physical hardware. My review process focused on the part that mattered for the architecture: the vendor dictionary and the implementation of the vendor integration interface.

The vendor-specific layer was intentionally simple. In most cases, the important part was the dictionary: whether the vendor attributes were correct, whether the dictionary format was valid, and whether it was loaded from the right place. The interface implementation only had to describe which devices the dictionary applied to, where the dictionary came from, and any small vendor-specific customizations.

Because the core RADIUS server, codec logic, authentication flow, and Keycloak integration were separated from vendor modules, a vendor contribution should not need to change the core logic. That was the main protection against regressions.

For code changes, CI required automated test coverage. New code had to keep coverage above the required threshold, around 85%, otherwise the build would not pass. So my validation process was: review the dictionary, review the interface implementation, make sure the contribution stayed inside the vendor extension boundary, and rely on automated tests and CI coverage gates to protect the core RADIUS server.

I would not claim that this fully validated the vendor hardware behavior. That responsibility mostly came from the community contributor who had the device and needed the integration. My responsibility was to keep the extension boundary clean and ensure that the contribution did not break the core plugin.

