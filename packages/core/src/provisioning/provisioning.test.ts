import { describe, expect, it } from "vitest";

import { defaultCapabilityCatalog } from "../capability/catalog.js";
import { evaluate } from "../policy/engine.js";
import type { AgeProfile, PolicyRequest } from "../policy/types.js";
import {
  DEFAULT_ADMIN_ROLES,
  IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES,
  IN_SPHERE_PROVISIONING_CAPABILITIES,
  IN_SPHERE_RUNTIME_GOVERNANCE_CAPABILITIES,
  PROVISIONING_TOOLS,
  bootstrapPolicies,
  defaultAdminPolicies,
  provisioningBindings,
} from "./provisioning.js";

function request(
  capabilityName: string,
  subject: { role: string; ageProfile: AgeProfile },
  sphereId = "sph_1",
): PolicyRequest {
  return {
    subject: { role: subject.role, ageProfile: subject.ageProfile },
    action: "execute",
    resource: { type: "capability", capabilityName },
    context: { sphereId, time: "2026-07-13T10:00:00Z", execution: "local", correlationId: "cor_x" },
  };
}

describe("provisioning catalog entries (RFC-008)", () => {
  const catalog = defaultCapabilityCatalog();

  // sphere.export is a deliberate exception (RFC-021): it hands over every
  // member's memory, so it is critical + approval-floored rather than high/no-floor.
  const PROVISIONING_ONLY = Object.keys(PROVISIONING_TOOLS).filter((name) => name !== "sphere.export");

  it.each(PROVISIONING_ONLY)("declares %s as admin-only/high-risk, no approval floor", (name) => {
    const cap = catalog.get(name);
    expect(cap).toBeDefined();
    expect(cap!.risk).toBe("high");
    expect(cap!.allowedProfiles).toEqual(["adult"]);
    expect(cap!.approvalFloor).toBe(false);
  });

  it("declares sphere.export as adult-only, critical, and approval-floored (RFC-021)", () => {
    const cap = catalog.get("sphere.export");
    expect(cap).toBeDefined();
    expect(cap!.risk).toBe("critical");
    expect(cap!.allowedProfiles).toEqual(["adult"]); // a minor can never export
    // The floor is what stops one administrator exporting another member's
    // private memory unilaterally: it forces a second human's approval.
    expect(cap!.approvalFloor).toBe(true);
  });
});

describe("provisioningBindings (RFC-008)", () => {
  it("binds provisioning and policy administration to local executor tools, enabled + high-risk", () => {
    const bindings = provisioningBindings();
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      "agent.create",
      "agent.update_config",
      "member.invite",
      "policy.manage",
      "sphere.create",
      "sphere.export",
    ]);
    // sphere.export carries the catalog's critical risk (RFC-021) so a policy
    // selecting on riskLevels sees the same risk the catalog states.
    expect(bindings.find((b) => b.capability === "sphere.export")?.risk).toBe("critical");
    for (const b of bindings.filter((b) => b.capability !== "sphere.export")) {
      expect(b.status).toBe("enabled");
      expect(b.runtime).toBe("local");
      expect(b.execution).toBe("local");
      expect(b.risk).toBe("high");
      expect(b.requiresApproval).toBe(false);
      expect(b.runtimeToolName).toBe(PROVISIONING_TOOLS[b.capability as keyof typeof PROVISIONING_TOOLS]);
    }
  });
});

describe("bootstrapPolicies (RFC-008)", () => {
  const policies = bootstrapPolicies();

  it("allows an adult to create a Sphere", () => {
    const d = evaluate(request("sphere.create", { role: "parent", ageProfile: "adult" }), policies);
    expect(d.effect).toBe("allow");
  });

  it("denies a non-adult (deny-by-default)", () => {
    for (const ageProfile of ["teen", "child"] as const) {
      const d = evaluate(request("sphere.create", { role: "guest", ageProfile }), policies);
      expect(d.effect).toBe("deny");
    }
  });

  it("grants nothing but sphere.create — every other capability is denied", () => {
    for (const name of ["member.invite", "agent.create", "payment.execute", "memory.search"]) {
      const d = evaluate(request(name, { role: "parent", ageProfile: "adult" }), policies);
      expect(d.effect).toBe("deny");
    }
  });
});

describe("defaultAdminPolicies (RFC-008)", () => {
  const policies = defaultAdminPolicies("sph_1");

  it("lets an administrator (parent) invite members and deploy/update agents", () => {
    for (const name of IN_SPHERE_PROVISIONING_CAPABILITIES) {
      const d = evaluate(request(name, { role: DEFAULT_ADMIN_ROLES[0]!, ageProfile: "adult" }), policies);
      expect(d.effect).toBe("allow");
    }
  });

  it("lets an administrator invoke runtime governance capabilities", () => {
    for (const name of IN_SPHERE_RUNTIME_GOVERNANCE_CAPABILITIES) {
      const d = evaluate(request(name, { role: DEFAULT_ADMIN_ROLES[0]!, ageProfile: "adult" }), policies);
      expect(d.effect).toBe("allow");
    }
  });

  it("lets an administrator manage Sphere settings: provider/model, connectors, packages", () => {
    for (const name of IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES) {
      const d = evaluate(request(name, { role: DEFAULT_ADMIN_ROLES[0]!, ageProfile: "adult" }), policies);
      expect(d.effect).toBe("allow");
    }
  });

  it("denies a non-administrator the Sphere settings capabilities by default", () => {
    for (const name of IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES) {
      for (const role of ["teenager", "child", "guest"]) {
        const d = evaluate(request(name, { role, ageProfile: "adult" }), policies);
        expect(d.effect).toBe("deny");
      }
    }
  });

  it("denies a non-administrator by default (child, guest)", () => {
    for (const role of ["child", "guest"]) {
      const d = evaluate(request("member.invite", { role, ageProfile: "adult" }), policies);
      expect(d.effect).toBe("deny");
    }
  });

  it("does not grant sphere.create (that is bootstrap-only) nor unrelated capabilities", () => {
    for (const name of ["sphere.create", "payment.execute"]) {
      const d = evaluate(request(name, { role: "parent", ageProfile: "adult" }), policies);
      expect(d.effect).toBe("deny");
    }
  });

  it("keys its policies to the given Sphere id", () => {
    expect(policies.every((p) => p.sphereId === "sph_1")).toBe(true);
  });
});
