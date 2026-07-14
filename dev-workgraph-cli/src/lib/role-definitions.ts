// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0
//
// IC Software Developer competency matrix (Scope & Impact, Execution, Collaboration,
// Business Impact) mapped to dev-workgraph role names. Used for init UX and LLM grounding.

import { ROLES } from "./project.js";

/** One competency dimension from the Software Developer IC matrix. */
interface RoleCompetencies {
  scopeAndImpact: readonly string[];
  execution: readonly string[];
  collaboration: readonly string[];
  businessImpact: readonly string[];
}

/** Full role definition for prompts and init. */
export interface RoleDefinition {
  /** One line for inquirer select labels. */
  shortSummary: string;
  /** Header blurb from the job-level column. */
  levelSummary: string;
  /** Official matrix level name. */
  matrixLevel: string;
  competencies: RoleCompetencies;
  questionEmphasis: string;
  cvEmphasis: string;
  doNotClaim: string;
}

function def(
  matrixLevel: string,
  shortSummary: string,
  levelSummary: string,
  competencies: RoleCompetencies,
  questionEmphasis: string,
  cvEmphasis: string,
  doNotClaim: string,
): RoleDefinition {
  return {
    matrixLevel,
    shortSummary,
    levelSummary,
    competencies,
    questionEmphasis,
    cvEmphasis,
    doNotClaim,
  };
}

export const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  "Junior Developer": def(
    "Software Developer I",
    "New to SWE; supervised, learning one domain",
    "Recent graduate or otherwise new to software development seeking to gain experience and grow.",
    {
      scopeAndImpact: [
        "Works with supervision on testing, coding and debugging straightforward problems and well-defined, low complexity solutions.",
        "Is focused primarily on learning one domain or product area.",
        "Requires assistance in unexpected situations or to resolve unexpected problems.",
        "Contributes to the overall success of their team and product area by delivering on their task assignments.",
      ],
      execution: [
        "Can work on a narrow range of technical problems based on their recent experiences.",
        "Works from technical designs developed exclusively or in conjunction with more experienced team members.",
        "Participates in code reviews with a focus on learning.",
        "Understands basic stages of a Software Development Lifecycle.",
        "Working knowledge of the main language(s) and major framework(s) used for the product areas they work on.",
        "Can effectively produce unit tests and simple integration tests.",
        "Learning how to effectively assess and estimate work effort.",
      ],
      collaboration: [
        "Seeks learning opportunities by collaborating with teammates.",
        "Forms relationships with immediate team members.",
        "Learns and follows team and company norms and standards.",
        "Openly accepts and incorporates feedback.",
        "Communicates with direct team members in a clear way.",
      ],
      businessImpact: [
        "Has basic knowledge of how businesses function and how Engineering contributes to businesses.",
        "Seeks to learn about our business domain and our customers.",
      ],
    },
    "assigned vs self-directed work, learning context, scope of autonomy, who reviewed or unblocked",
    "implemented assigned work, contributed under review, bounded autonomy, learning context — honest scope without inflated leadership",
    "Do not claim design ownership, cross-team architecture, org-wide adoption, or mentoring scope unless confirmed in human answers.",
  ),

  "Middle Developer": def(
    "Software Developer II",
    "Developing contributor; medium–high complexity with little supervision",
    "Developing contributor on a software development team.",
    {
      scopeAndImpact: [
        "Works with little or no supervision implementing solutions to medium to high complexity problems.",
        "Is effective in the domain, product area, or components they most frequently work with.",
        "Contributes to the overall success of their team and product area by applying their developing knowledge and experience.",
      ],
      execution: [
        "Can effectively work on a range of medium to high complexity technical problems within their domain or product area.",
        "Can create technical designs, often with assistance, for solutions to problems.",
        "Proactively performs routine tech debt refactoring for the code being changed and documents areas that require more extensive refactoring.",
        "Participates actively in code reviews.",
        "Takes initiative to solve problems once identified; may require assistance in prioritizing.",
        "Generally produces code that meets the expectations of the team.",
        "Demonstrates a good understanding of software development lifecycle and can identify and suggest team process improvements.",
        "Capable of debugging some production issues, sometimes requiring assistance.",
        "Builds solutions with testability and observability.",
        "Work estimates are somewhat reliable and consider many aspects of delivery though still can fall into a wide range.",
        "Proactively identifies risks.",
      ],
      collaboration: [
        "Assists teammates who ask for assistance.",
        "Builds relationships with teammates and those on other engineering teams.",
        "Contributes to team and departmental meetings.",
        "May mentor interns and assist onboarding new teammates.",
        "Openly accepts and incorporates feedback.",
        "Provides candid, respectful feedback to peers.",
        "Effective communicator that can present technical information to peers.",
      ],
      businessImpact: [
        "Understands the business and generally how it creates value.",
        "Understands many of the problems customers want to solve and may sometimes anticipate future customer needs.",
        "Can identify the major customer types and user roles or personae.",
        "Can support communication with customers and partners on specific features or issues.",
      ],
    },
    "feature/module ownership, design input vs execution-only, production support scope, collaboration across teams",
    "delivered features or modules with clear scope, collaboration on design, owned flows or components — no principal/staff-level platform claims",
    "Do not claim product-line tech lead, department-wide impact, or strategic roadmap ownership unless confirmed in human answers.",
  ),

  "Senior Developer": def(
    "Senior Software Developer",
    "Reliable team contributor; influence across the team",
    "Solid and reliable contributor on a software development team whose influence impacts their entire team.",
    {
      scopeAndImpact: [
        "Works independently solving a broad range of medium to high complexity problems.",
        "Is effective in multiple domains, products, or components.",
        "Capable to serve as a technical lead for a module or component.",
        "Contributes to the overall success of their team and product area by applying their considerable knowledge and experience.",
      ],
      execution: [
        "Can effectively work on a broad range of complex technical problems.",
        "Can independently create technical designs that other team members can use.",
        "Produces code without major defects.",
        "Understands and articulates design tradeoffs.",
        "Proactively performs and recommends routine tech debt refactoring while delivering on the project.",
        "Takes initiative to solve problems and has good judgment to know when a solution can be delayed safely.",
        "Contributes effectively to code reviews and can anticipate current and future issues.",
        "Capable of debugging most production issues without assistance.",
        "Promotes and supports software quality best practices and identifies new automation opportunities.",
        "Builds solutions with testability and observability.",
        "Uses both engineering and product metrics to design and recommend improvements.",
        "Work estimates are increasingly more reliable and fall within narrower range with justification.",
        "Proactively identifies risks and proposes mitigations.",
      ],
      collaboration: [
        "Assists teammates who ask for assistance while still delivering on their own commitments.",
        "Seeks to form and improve relationships with other members of the team and establishes relationships with those on other teams.",
        "Assists in actively helping improve morale on the team.",
        "Contributes to team and departmental meetings.",
        "Assists in recruiting new team members.",
        "Mentors junior and student members of the team.",
        "Openly accepts and incorporates feedback.",
        "Provides candid, respectful feedback to peers.",
        "Effective communicator that can present technical information to even non-technical audiences.",
        "Participates in demo sessions to present features and enhancements to a wide internal audience.",
      ],
      businessImpact: [
        "Understands the business and how it creates value.",
        "Understands the major problems customers want to solve and can sometimes anticipate future customer needs.",
        "Can identify all current customer types and user roles or personae.",
        "Recommends product and technical enhancements and connects them to desired business outcomes.",
      ],
    },
    "feature/design ownership, customer or product driver, replacing manual processes, mentoring or review scope",
    "end-to-end feature or module ownership, concrete design decisions, product/driver context, mentoring or review scope when stated",
    "Do not claim product-line-wide tech lead, company-level strategy, or industry impact unless confirmed in human answers.",
  ),

  "Staff Developer": def(
    "Staff Software Developer",
    "Product-line tech lead; department + triad influence",
    "Often the most senior developer on a development team. Their influence extends beyond the team to the entire department and product line.",
    {
      scopeAndImpact: [
        "Works independently solving problems of any complexity for an entire product line.",
        "Is effective in multiple domains, products, or components.",
        "Often serves as a technical lead for multiple components or an entire domain.",
        "Often a direct collaborator in a product development triad along with product management, design and engineering managers.",
        "Contributes to the overall success of the organization and product area by applying their considerable knowledge and experience.",
      ],
      execution: [
        "Focuses on a broad range of complex technical problems and breaks them down to challenges that are compatible with less experienced developers.",
        "Understands and articulates design tradeoffs for any level of problem.",
        "Consistently builds solutions with testability, observability, extensibility, and maintainability embedded.",
        "Efficiently produces code of the highest quality.",
        "Raises the quality of code and solutions across the team.",
        "Proactively performs and recommends tech debt refactoring while delivering on the project.",
        "Capable of debugging production issues independently.",
        "Directs and promotes software quality best practices and identifies new automation opportunities.",
        "Work estimates are reliable and take into account all aspects of delivery for cross-domain projects and consider the skills of the team.",
        "Proactively identifies risks and proposes mitigations.",
      ],
      collaboration: [
        "Serves as the technology lead for their team, and can serve as a technology lead for cross-team initiatives.",
        "Contributes to overall architecture along with other staff and principal developers.",
        "Proactively engages with others outside of the team or department to lend assistance or to develop key relationships.",
        "Assists in helping improve morale in the department.",
        "Assists in recruiting and leads the technical assessment of new team members.",
        "Mentors senior members of the team.",
        "Openly accepts and incorporates feedback.",
        "Proactively provides candid, respectful feedback to peers in all roles across teams.",
        "Effective communicator in both written and verbal forms; can present technical information to a wide variety of technical and non-technical audiences.",
      ],
      businessImpact: [
        "Understands the business and how it creates value.",
        "Engages with customers directly assisting our customer facing teams in solving customer issues in more technical areas.",
        "Can anticipate future customer needs and identify potential new customer types.",
        "Recommends product and technical enhancements and connects them to desired business outcomes.",
      ],
    },
    "design ownership across subsystems, platform direction, integration with adjacent systems",
    "design ownership across subsystems, platform/integration direction, technical standards that others build on",
    "Do not claim company-wide strategic leadership, industry-level impact, or department-wide architecture sole ownership unless confirmed in human answers.",
  ),

  "Principal Developer": def(
    "Principal Software Developer",
    "Company-level (sometimes industry) strategic technical impact",
    "The pinnacle of software developer experience whose impact is felt at the strategic company-level and sometimes even industry-level.",
    {
      scopeAndImpact: [
        "Works autonomously solving problems of any complexity across product lines and business domains and whose impact is recognized at the company level.",
        "Work is frequently self-initiated and not tied to any one particular team.",
        "Aligns the technical direction of teams through effective leadership and collaboration with staff and senior team members.",
        "Serves as a strategic technical lead for the engineering team.",
        "Works with product, engineering and design leaders to help shape long term roadmaps.",
        "Contributes to the overall success of the organization by applying their considerable knowledge, experience and leadership.",
      ],
      execution: [
        "Focuses efforts on helping the engineering department and company meet its goals.",
        "Is effective in all of the domains, products, and components at the company.",
        "Understands and articulates design tradeoffs for any level of problem.",
        "Consistently builds solutions with testability, observability, extensibility, and maintainability embedded.",
        "Efficiently produces code of the highest quality.",
        "Raises the quality of code and solutions across the department.",
        "Plans and roadmaps enhancements to advance the quality and capability of our solutions and avoid tech debt pitfalls in the future.",
        "Directs and promotes software quality best practices and identifies new automation opportunities.",
        "Anticipates future risks and incorporates them into a technology roadmap.",
        "Can reliably estimate effort even for ambiguous situations.",
        "Tracks new trends, technologies, approaches and incorporates them into future plans.",
      ],
      collaboration: [
        "Serves as the technology lead for one or more product lines or even the department as a whole.",
        "Leads the overall architecture for one or more product lines either independently or in collaboration with other principal developers.",
        "Establishes relationships across the organization and with industry leaders.",
        "Assists in helping actively improve morale at the company.",
        "Contributes to strategic meetings and discussions.",
        "Assists in recruiting and leads the technical assessment of new senior and staff level team members.",
        "Mentors senior and staff members of the department.",
        "Openly accepts and incorporates feedback.",
        "Proactively provides candid, respectful feedback to all they interact with.",
        "Effective communicator that can present on a wide variety of topics to the company, customers, or industry audiences.",
      ],
      businessImpact: [
        "Understands the business, and the strategies used to generate value.",
        "Engages with customers directly to understand the nuances of their problems and can anticipate future customer needs.",
        "Identifies competing customer requirements and proposes value-based solutions.",
        "Recommends product and technical enhancements and connects them to desired business outcomes.",
      ],
    },
    "system-wide trade-offs, cross-team boundaries, long-term architectural consequences, org-scale production adoption",
    "system boundaries, cross-team architecture, long-term platform direction, org-scale consequences — not line-level implementation unless that is all the evidence shows",
    "Do not invent production usage, customer impact, or industry influence unless explicitly confirmed in human answers.",
  ),

  "Junior Frontend Developer": def(
    "Software Developer I (Frontend)",
    "New to frontend; supervised, learning UI domain",
    "Recent graduate or otherwise new to software development seeking to gain experience and grow (frontend track).",
    {
      scopeAndImpact: [
        "Works with supervision on UI implementation, component work, and debugging of low to medium complexity tasks.",
        "Focused primarily on learning one product surface or frontend domain.",
        "Requires assistance in unexpected UI, accessibility, or integration situations.",
        "Contributes to team success by delivering assigned UI tasks.",
      ],
      execution: [
        "Implements components and flows from designs with guidance.",
        "Participates in code reviews with a focus on learning patterns and team standards.",
        "Working knowledge of the main frontend framework(s) and styling approach for the product.",
        "Can produce unit tests for components; learning integration and e2e testing.",
      ],
      collaboration: [
        "Collaborates with teammates and seeks feedback from designers or senior developers.",
        "Communicates clearly with the immediate team about progress and blockers.",
      ],
      businessImpact: [
        "Learning how the product creates value for users.",
        "Seeks to understand user flows and customer context.",
      ],
    },
    "assigned vs self-directed UI work, learning context, design handoff vs implementation-only, who reviewed or unblocked",
    "implemented UI tasks under review, contributed to components, bounded autonomy — honest scope without inflated leadership",
    "Do not claim design-system ownership, cross-product frontend architecture, or org-wide UI standards unless confirmed in human answers.",
  ),

  "Middle Frontend Developer": def(
    "Software Developer II (Frontend)",
    "Developing frontend contributor; medium complexity UI work",
    "Developing contributor on a software development team (frontend track).",
    {
      scopeAndImpact: [
        "Works with little or no supervision on medium to high complexity UI problems within their product area.",
        "Effective in the components, routes, or surfaces they most frequently work with.",
        "Contributes to product area success by applying developing frontend knowledge.",
      ],
      execution: [
        "Builds features and flows with testability and accessibility in mind.",
        "Can propose component structure, often with assistance from seniors.",
        "Participates actively in code reviews; proactively refactors UI tech debt in touched areas.",
        "Debugs frontend and integration issues, sometimes requiring assistance.",
      ],
      collaboration: [
        "Assists teammates on UI tasks; collaborates with backend on API contracts.",
        "Presents technical UI topics to peers.",
      ],
      businessImpact: [
        "Understands user problems the UI addresses.",
        "Can support communication on specific features with PM or support.",
      ],
    },
    "feature/flow ownership, UX vs implementation scope, API integration ownership, accessibility responsibility",
    "shipped UI features or flows with clear scope, component/module ownership, collaboration on design — no staff-level platform claims",
    "Do not claim design-system or cross-product frontend platform lead unless confirmed in human answers.",
  ),

  "Senior Frontend Developer": def(
    "Senior Software Developer (Frontend)",
    "Reliable frontend contributor; influence across the team",
    "Solid and reliable frontend contributor whose influence impacts their entire team.",
    {
      scopeAndImpact: [
        "Works independently on complex UI architecture within modules or features.",
        "Effective across multiple surfaces or shared component areas.",
        "Can serve as technical lead for a UI module or feature area.",
      ],
      execution: [
        "Creates component and state designs others can follow.",
        "Articulates tradeoffs for performance, accessibility, and maintainability.",
        "Debugs production UI issues; promotes testing and observability for the frontend.",
        "Uses metrics to recommend UI performance and quality improvements.",
      ],
      collaboration: [
        "Mentors junior frontend developers; assists recruiting.",
        "Presents to non-technical audiences; participates in demos.",
      ],
      businessImpact: [
        "Connects UI work to customer outcomes.",
        "Recommends product and technical UI enhancements tied to business goals.",
      ],
    },
    "feature-level UI ownership, component architecture, UX/product driver context, mentoring or review scope",
    "feature-level UI ownership, component architecture, UX/product driver context, mentoring or review scope when stated",
    "Do not claim org-wide design-system or frontend platform strategy unless confirmed in human answers.",
  ),

  "Staff Frontend Developer": def(
    "Staff Software Developer (Frontend)",
    "Frontend tech lead across product line",
    "Often the most senior frontend developer on a team; influence extends to department and product line.",
    {
      scopeAndImpact: [
        "Leads frontend technical direction for a product line or major surface.",
        "Often tech lead for shared UI layers, design-system integration, or cross-feature frontend architecture.",
        "Collaborates in product triad on frontend feasibility and roadmap.",
      ],
      execution: [
        "Breaks down complex UI/platform work for less experienced developers.",
        "Embeds performance, accessibility, and maintainability across the frontend stack.",
        "Raises frontend quality and standards across the team.",
      ],
      collaboration: [
        "Tech lead for frontend on the team and cross-team UI initiatives.",
        "Contributes to frontend architecture with staff and principal engineers.",
        "Mentors senior frontend developers; leads frontend technical interviews.",
      ],
      businessImpact: [
        "Engages with customers on technical UI issues via customer-facing teams.",
        "Anticipates user needs; connects frontend investments to outcomes.",
      ],
    },
    "frontend subsystem ownership, design-system or platform direction, integration with backend/API contracts",
    "frontend subsystem ownership, design-system or platform direction, integration with backend/API contracts",
    "Do not claim company-wide frontend strategy or industry thought leadership unless confirmed in human answers.",
  ),

  "Principal Frontend Developer": def(
    "Principal Software Developer (Frontend)",
    "Company-level frontend architecture and strategy",
    "Pinnacle frontend IC; impact at company level and sometimes industry level.",
    {
      scopeAndImpact: [
        "Aligns frontend technical direction across product lines; impact at company level.",
        "Self-initiated work on design systems, platform UX, or cross-product frontend strategy.",
        "Shapes long-term frontend roadmaps with product and design leadership.",
      ],
      execution: [
        "Plans frontend platform enhancements and avoids systemic UI tech debt.",
        "Raises frontend quality across the department; anticipates risks in technology roadmap.",
        "Tracks frontend trends and incorporates them into future plans.",
      ],
      collaboration: [
        "Leads frontend architecture for product lines; mentors staff and seniors.",
        "Presents to company, customers, or industry on frontend topics.",
        "Leads assessment of senior and staff frontend candidates.",
      ],
      businessImpact: [
        "Understands business strategy; proposes value-based frontend solutions.",
        "Engages with customers on nuanced UX and platform problems.",
      ],
    },
    "cross-product frontend architecture, design-system/platform standards, org-scale UX and performance adoption",
    "frontend architecture across products, design-system/platform direction, cross-team UI standards, performance and accessibility at scale",
    "Do not invent org-wide adoption or industry influence unless explicitly confirmed in human answers.",
  ),
};

/** Validates that every {@link ROLES} entry has a definition. */
for (const role of ROLES) {
  if (!ROLE_DEFINITIONS[role]) {
    throw new Error(`Missing ROLE_DEFINITIONS entry for "${role}"`);
  }
}

const FALLBACK_CV =
  "ownership, scope, and technical decisions appropriate to the stated role — no seniority inflation";
const FALLBACK_QUESTIONS = "what Git cannot show — ownership, intent, production use";

/** Lookup role definition; undefined for unknown roles. */
export function roleDefinitionFor(role: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS[role];
}

/** CV bullet framing for a role. */
export function cvEmphasisForRole(role: string): string {
  return ROLE_DEFINITIONS[role]?.cvEmphasis ?? FALLBACK_CV;
}

/** What open questions should probe for a role. */
export function questionEmphasisForRole(role: string): string {
  return ROLE_DEFINITIONS[role]?.questionEmphasis ?? FALLBACK_QUESTIONS;
}

/** Compact block for LLM prompts (avoids repeating full competency lists on every commit). */
export function roleDefinitionPromptBlock(role: string): string {
  const d = ROLE_DEFINITIONS[role];
  if (!d) return `Developer role: ${role}`;
  return [
    `ROLE DEFINITION (${d.matrixLevel}):`,
    d.levelSummary,
    `Impact sphere: ${d.shortSummary}`,
    `Prefer question topics about: ${d.questionEmphasis}`,
    "Do not address the developer by role title in questions or use performance-review tone.",
    `Narrative/CV emphasis: ${d.cvEmphasis}`,
    `Do NOT claim unless confirmed in human answers: ${d.doNotClaim}`,
  ].join("\n");
}

function formatBullets(title: string, items: readonly string[]): string[] {
  return [title, ...items.map((b) => `  - ${b}`), ""];
}

/** Full competency text for console output after role selection. */
export function formatRoleDefinitionForConsole(role: string): string {
  const d = ROLE_DEFINITIONS[role];
  if (!d) return `Role: ${role}`;
  return [
    `${role} (≈ ${d.matrixLevel})`,
    d.levelSummary,
    "",
    ...formatBullets("Scope & Impact:", d.competencies.scopeAndImpact),
    ...formatBullets("Execution:", d.competencies.execution),
    ...formatBullets("Collaboration:", d.competencies.collaboration),
    ...formatBullets("Business Impact:", d.competencies.businessImpact),
  ].join("\n");
}

/** One-line label for inquirer select. */
export function roleChoiceLabel(role: string): string {
  const d = ROLE_DEFINITIONS[role];
  return d ? `${role} — ${d.shortSummary}` : role;
}
