import { describe, expect, it } from "vitest";
import { ROLES } from "../../../src/lib/project.js";
import {
  cvEmphasisForRole,
  formatRoleDefinitionForConsole,
  questionEmphasisForRole,
  roleChoiceLabel,
  roleDefinitionFor,
  roleDefinitionPromptBlock,
  ROLE_DEFINITIONS,
  type RoleDefinition,
} from "../../../src/lib/role-definitions.js";

const COMPETENCY_KEYS = [
  "scopeAndImpact",
  "execution",
  "collaboration",
  "businessImpact",
] as const;

function expectCompleteDefinition(role: string, d: RoleDefinition): void {
  expect(d.matrixLevel.length).toBeGreaterThan(0);
  expect(d.shortSummary.length).toBeGreaterThan(0);
  expect(d.levelSummary.length).toBeGreaterThan(0);
  expect(d.questionEmphasis.length).toBeGreaterThan(0);
  expect(d.cvEmphasis.length).toBeGreaterThan(0);
  expect(d.doNotClaim.length).toBeGreaterThan(0);
  for (const key of COMPETENCY_KEYS) {
    expect(d.competencies[key].length, `${role}.${key}`).toBeGreaterThan(0);
    for (const bullet of d.competencies[key]) {
      expect(bullet.length).toBeGreaterThan(10);
    }
  }
}

describe("ROLE_DEFINITIONS", () => {
  it("defines every init role with no extras", () => {
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual([...ROLES].sort());
  });

  it("gives each role a complete definition", () => {
    for (const role of ROLES) {
      const d = ROLE_DEFINITIONS[role];
      expect(d, role).toBeDefined();
      expectCompleteDefinition(role, d!);
    }
  });

  it("maps backend roles to general Software Developer matrix levels", () => {
    expect(ROLE_DEFINITIONS["Junior Developer"]!.matrixLevel).toBe("Software Developer I");
    expect(ROLE_DEFINITIONS["Principal Developer"]!.matrixLevel).toBe(
      "Principal Software Developer",
    );
    expect(ROLE_DEFINITIONS["Staff Developer"]!.matrixLevel).toBe("Staff Software Developer");
  });

  it("maps frontend roles to Frontend matrix levels", () => {
    for (const role of ROLES) {
      if (!role.includes("Frontend")) continue;
      expect(ROLE_DEFINITIONS[role]!.matrixLevel).toMatch(/Frontend/);
    }
  });

  it("keeps frontend and backend Junior definitions distinct", () => {
    const backend = ROLE_DEFINITIONS["Junior Developer"]!;
    const frontend = ROLE_DEFINITIONS["Junior Frontend Developer"]!;
    expect(backend.questionEmphasis).not.toEqual(frontend.questionEmphasis);
    expect(backend.cvEmphasis).not.toEqual(frontend.cvEmphasis);
    expect(backend.competencies.scopeAndImpact[0]).not.toEqual(
      frontend.competencies.scopeAndImpact[0],
    );
  });
});

describe("roleDefinitionFor", () => {
  it("returns the same object as ROLE_DEFINITIONS for known roles", () => {
    for (const role of ROLES) {
      expect(roleDefinitionFor(role)).toBe(ROLE_DEFINITIONS[role]);
    }
  });

  it("returns undefined for unknown roles", () => {
    expect(roleDefinitionFor("Consultant")).toBeUndefined();
  });
});

describe("roleDefinitionPromptBlock", () => {
  it("includes matrix level and anti-inflation guard for Staff", () => {
    const block = roleDefinitionPromptBlock("Staff Developer");
    expect(block).toContain("ROLE DEFINITION (Staff Software Developer):");
    expect(block).toContain("product line");
    expect(block).toContain("Open questions should probe:");
    expect(block).toContain("Narrative/CV emphasis:");
    expect(block).toContain("Do NOT claim unless confirmed in human answers:");
  });

  it("differs from Principal on scope", () => {
    const staff = roleDefinitionPromptBlock("Staff Developer");
    const principal = roleDefinitionPromptBlock("Principal Developer");
    expect(staff).toContain("product line");
    expect(principal).toContain("company");
    expect(staff).not.toEqual(principal);
  });

  it("embeds level summary and impact sphere", () => {
    const block = roleDefinitionPromptBlock("Senior Developer");
    expect(block).toContain(ROLE_DEFINITIONS["Senior Developer"]!.levelSummary);
    expect(block).toContain(
      `Impact sphere: ${ROLE_DEFINITIONS["Senior Developer"]!.shortSummary}`,
    );
  });

  it("falls back to a plain role line for unknown roles", () => {
    expect(roleDefinitionPromptBlock("Consultant")).toBe("Developer role: Consultant");
  });

  it("calibrates open questions by seniority", () => {
    const junior = roleDefinitionPromptBlock("Junior Developer");
    const principal = roleDefinitionPromptBlock("Principal Developer");
    expect(junior).toContain("assigned");
    expect(principal).toContain("system-wide");
    expect(junior).not.toContain("system-wide");
  });
});

describe("formatRoleDefinitionForConsole", () => {
  it("includes role title, matrix level, and all four competency sections", () => {
    const text = formatRoleDefinitionForConsole("Senior Developer");
    expect(text).toMatch(/^Senior Developer \(≈ Senior Software Developer\)/);
    expect(text).toContain(ROLE_DEFINITIONS["Senior Developer"]!.levelSummary);
    expect(text).toContain("Scope & Impact:");
    expect(text).toContain("Execution:");
    expect(text).toContain("Collaboration:");
    expect(text).toContain("Business Impact:");
  });

  it("renders competency bullets with indentation", () => {
    const text = formatRoleDefinitionForConsole("Middle Developer");
    const firstBullet = ROLE_DEFINITIONS["Middle Developer"]!.competencies.scopeAndImpact[0]!;
    expect(text).toContain(`  - ${firstBullet}`);
  });

  it("falls back for unknown roles", () => {
    expect(formatRoleDefinitionForConsole("Consultant")).toBe("Role: Consultant");
  });
});

describe("roleChoiceLabel", () => {
  it("includes role name and short summary", () => {
    expect(roleChoiceLabel("Principal Developer")).toBe(
      `Principal Developer — ${ROLE_DEFINITIONS["Principal Developer"]!.shortSummary}`,
    );
  });

  it("returns the role name alone when unknown", () => {
    expect(roleChoiceLabel("Consultant")).toBe("Consultant");
  });
});

describe("emphasis helpers", () => {
  it("returns role-specific CV and question emphasis", () => {
    expect(cvEmphasisForRole("Principal Developer")).toContain("system boundaries");
    expect(questionEmphasisForRole("Junior Developer")).toContain("assigned");
    expect(cvEmphasisForRole("Staff Frontend Developer")).toContain("frontend subsystem");
    expect(questionEmphasisForRole("Middle Frontend Developer")).toContain("feature/flow");
  });

  it("falls back for unknown roles", () => {
    expect(cvEmphasisForRole("Consultant")).toContain("no seniority inflation");
    expect(questionEmphasisForRole("Consultant")).toContain("what Git cannot show");
  });

  it("uses distinct emphasis strings across seniority ladder", () => {
    const questions = ROLES.map((r) => questionEmphasisForRole(r));
    const cv = ROLES.map((r) => cvEmphasisForRole(r));
    expect(new Set(questions).size).toBe(ROLES.length);
    expect(new Set(cv).size).toBe(ROLES.length);
  });

  it("includes anti-inflation doNotClaim themes in CV emphasis for every role", () => {
    for (const role of ROLES) {
      const d = ROLE_DEFINITIONS[role]!;
      expect(d.doNotClaim.toLowerCase()).toMatch(/do not claim|do not invent/);
      expect(cvEmphasisForRole(role)).toBe(d.cvEmphasis);
      expect(questionEmphasisForRole(role)).toBe(d.questionEmphasis);
    }
  });
});
