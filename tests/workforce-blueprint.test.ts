import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_MAX_COMPANIONS,
  BLUEPRINT_MAX_DEPARTMENTS,
  BLUEPRINT_MAX_SKILLS,
  hydrateWorkforceBlueprint,
  normalizeWorkforceBlueprint,
  parseBlueprintJson,
  templateWorkforceBlueprint,
} from "../packages/shared/src/workforce-blueprint.ts";

describe("workforce blueprint", () => {
  it("adds an industry department from the library", () => {
    const plan = templateWorkforceBlueprint({ industry: "Dental clinic in Jeddah" });
    expect(plan.source).toBe("template");
    expect(plan.departments.map((dept) => dept.name)).toContain("Patient services");
    expect(plan.departments.length).toBeLessThanOrEqual(BLUEPRINT_MAX_DEPARTMENTS);
    expect(plan.departments.every((dept) => dept.companions.length > 0)).toBe(true);
  });

  it("writes the template in Arabic", () => {
    const plan = templateWorkforceBlueprint({ industry: "شركة برمجيات", locale: "ar" });
    expect(plan.departments.some((dept) => dept.name === "المنتج والهندسة")).toBe(true);
    expect(plan.summary).toMatch(/البرمجيات/);
  });

  it("parses fenced model JSON and clamps it", () => {
    const companions = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, role: "Analyst" }));
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
      summary: "Plan",
      departments: [
        { name: "Ops", purpose: "Run", companions },
        { name: "ops", purpose: "duplicate", companions },
        { name: "Empty", companions: [] },
      ],
    })}\n\`\`\``;
    const plan = normalizeWorkforceBlueprint(parseBlueprintJson(reply), { industry: "Logistics" });
    expect(plan?.source).toBe("ai");
    expect(plan?.departments).toHaveLength(1);
    expect(plan?.departments[0]?.companions).toHaveLength(BLUEPRINT_MAX_COMPANIONS);
  });

  it("teaches every template companion industry skills and writes department playbooks", () => {
    const plan = templateWorkforceBlueprint({ industry: "Dental clinic in Jeddah" });
    for (const dept of plan.departments) {
      expect(dept.playbook).toContain(dept.name);
      expect(dept.playbook).toContain("Dental clinic in Jeddah");
      for (const person of dept.companions) {
        expect(person.skills.length).toBeGreaterThan(0);
        expect(person.skills.some((skill) => skill.instructions.includes("Dental clinic"))).toBe(true);
      }
    }
  });

  it("keeps model skills, clamps them, and fills gaps", () => {
    const skills = Array.from({ length: 7 }, (_, i) => ({
      title: `Skill ${i}`,
      instructions: "Collect the inputs, draft the output, request approval.",
    }));
    const plan = normalizeWorkforceBlueprint(
      {
        departments: [
          {
            name: "Sales",
            playbook: "Mission: close deals.\nApprovals: prices.",
            companions: [
              { name: "Sara", role: "Lead", skills },
              { name: "Omar", role: "Rep", skills: [{ title: "x", instructions: "short" }] },
            ],
          },
          { name: "Support", companions: [{ name: "Lina", role: "Agent" }] },
        ],
      },
      { industry: "Car rental", locale: "en" },
    );
    const [sales, support] = plan?.departments ?? [];
    expect(sales?.playbook).toBe("Mission: close deals.\nApprovals: prices.");
    expect(sales?.companions[0]?.skills).toHaveLength(BLUEPRINT_MAX_SKILLS);
    expect(sales?.companions[1]?.skills[0]?.instructions).toContain("Car rental");
    expect(support?.playbook).toContain("Car rental");
  });

  it("hydrates blueprints from servers without skills", () => {
    const legacy = {
      industry: "Bakery",
      summary: "",
      source: "ai" as const,
      departments: [
        { name: "Kitchen", purpose: "Bake", companions: [{ name: "Ali", role: "Baker", specialty: null, instructions: "Bake." }] },
      ],
    };
    const plan = hydrateWorkforceBlueprint(legacy as never, { industry: "Bakery", locale: "ar" });
    expect(plan.departments[0]?.companions[0]?.skills.length).toBeGreaterThan(0);
    expect(plan.departments[0]?.playbook).toContain("دليل");
  });

  it("rejects unusable model output", () => {
    expect(normalizeWorkforceBlueprint(parseBlueprintJson("no json here"), { industry: "x" })).toBeNull();
    expect(normalizeWorkforceBlueprint({ departments: [] }, { industry: "x" })).toBeNull();
  });
});
