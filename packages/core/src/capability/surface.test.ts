import { describe, expect, it } from "vitest";

import type { Policy, PolicyRequest } from "../policy/types.js";
import type { CapabilityBinding } from "./types.js";
import { defaultCapabilityCatalog } from "./catalog.js";
import { resolveAuthorizedCapabilities } from "./surface.js";

const ctx: PolicyRequest["context"] = {
  sphereId: "sph_1",
  time: "2026-06-27T10:00:00.000Z",
  execution: "local",
  correlationId: "cor_1",
};

const allowSearch: Policy = {
  id: "pol_search",
  sphereId: "sph_1",
  description: "Anyone may search memory.",
  subjectSelector: {},
  action: "execute",
  resourceSelector: { capabilityNames: ["memory.search"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

const approvePay: Policy = {
  id: "pol_pay",
  sphereId: "sph_1",
  description: "Payments need approval.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["payment.execute"] },
  effect: "require_approval",
  approverRoles: ["parent"],
  priority: 0,
  version: 1,
  status: "active",
};

const catalog = defaultCapabilityCatalog();

describe("resolveAuthorizedCapabilities (RFC-007 offered surface)", () => {
  const adult = { memberId: "mbr_1", role: "parent", ageProfile: "adult" } as const;

  it("offers only capabilities the Policy Engine authorizes (deny by default)", () => {
    const surface = resolveAuthorizedCapabilities(adult, ctx, { catalog, policies: [allowSearch] });
    expect(surface.map((c) => c.name)).toEqual(["memory.search"]);
  });

  it("offers nothing when no policy grants anything", () => {
    expect(resolveAuthorizedCapabilities(adult, ctx, { catalog, policies: [] })).toEqual([]);
  });

  it("narrows the surface to the agent's declared scope — policy ∩ scope (RFC-027)", () => {
    // Policy allows both, but the agent is scoped to only memory.search.
    const surface = resolveAuthorizedCapabilities(adult, ctx, {
      catalog,
      policies: [allowSearch, approvePay],
      agentScope: ["memory.search"],
    });
    expect(surface.map((c) => c.name)).toEqual(["memory.search"]); // payment.execute excluded by scope
  });

  it("scope never widens: an in-scope but policy-denied capability stays denied (RFC-027)", () => {
    const surface = resolveAuthorizedCapabilities(adult, ctx, {
      catalog,
      policies: [], // nothing allowed
      agentScope: ["memory.search", "payment.execute"],
    });
    expect(surface).toEqual([]);
  });

  it("an empty scope offers nothing (deny by default, RFC-027)", () => {
    expect(resolveAuthorizedCapabilities(adult, ctx, { catalog, policies: [allowSearch], agentScope: [] })).toEqual([]);
  });

  it("includes a require_approval capability but flags it requiresApproval", () => {
    const surface = resolveAuthorizedCapabilities(adult, ctx, {
      catalog,
      policies: [allowSearch, approvePay],
    });
    const pay = surface.find((c) => c.name === "payment.execute");
    expect(pay).toBeDefined();
    expect(pay?.requiresApproval).toBe(true);
    // memory.search is a plain allow, no approval.
    expect(surface.find((c) => c.name === "memory.search")?.requiresApproval).toBe(false);
  });

  it("never offers a capability outside the subject's profile floor", () => {
    const child = { memberId: "mbr_c", role: "child", ageProfile: "child" } as const;
    // A policy that would allow payment for a child cannot widen the catalog floor.
    const allowPayChild: Policy = { ...approvePay, id: "pol_pc", subjectSelector: {}, effect: "allow" };
    const surface = resolveAuthorizedCapabilities(child, ctx, { catalog, policies: [allowPayChild] });
    expect(surface.find((c) => c.name === "payment.execute")).toBeUndefined();
  });

  it("when bindings are provided, only bound capabilities are offered (deny by default)", () => {
    const binding: CapabilityBinding = {
      capability: "memory.search",
      runtime: "local",
      runtimeToolName: "mem.search",
      execution: "local",
      risk: "low",
      requiresApproval: false,
      status: "enabled",
    };
    // payment.execute is allowed by policy but has no binding → not offered.
    const allowAll: Policy = { ...allowSearch, id: "pol_all", resourceSelector: {} };
    const surface = resolveAuthorizedCapabilities(adult, ctx, {
      catalog,
      policies: [allowAll],
      bindings: [binding],
    });
    expect(surface.map((c) => c.name)).toEqual(["memory.search"]);
  });
});
