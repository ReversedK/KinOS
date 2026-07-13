import { describe, expect, it } from "vitest";

import { defaultCapabilityCatalog } from "../capability/catalog.js";
import { evaluate } from "../policy/engine.js";
import type { AgeProfile, PolicyRequest } from "../policy/types.js";
import {
  DEFAULT_ADMIN_ROLES,
  IN_SPHERE_PROVISIONING_CAPABILITIES,
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

  it.each(Object.keys(PROVISIONING_TOOLS))("declares %s as admin-only/high-risk, no approval floor", (name) => {
    const cap = catalog.get(name);
    expect(cap).toBeDefined();
    expect(cap!.risk).toBe("high");
    expect(cap!.allowedProfiles).toEqual(["adult"]);
    expect(cap!.approvalFloor).toBe(false);
  });
});

describe("provisioningBindings (RFC-008)", () => {
  it("binds the four provisioning capabilities to local executor tools, enabled + high-risk", () => {
    const bindings = provisioningBindings();
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      "agent.create",
      "agent.update_config",
      "member.invite",
      "sphere.create",
    ]);
    for (const b of bindings) {
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
