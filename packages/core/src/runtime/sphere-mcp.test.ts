import { describe, expect, it } from "vitest";

import { InMemoryAuditSink } from "../audit/events.js";
import { defaultCapabilityCatalog } from "../capability/catalog.js";
import type { CapabilityBinding, CapabilityExecutor } from "../capability/types.js";
import type { Policy } from "../policy/types.js";
import { handleSphereMcpCall, type ResolvedAgentIdentity, type SphereMcpDeps } from "./sphere-mcp.js";

const searchBinding: CapabilityBinding = {
  capability: "memory.search",
  runtime: "hermes",
  runtimeToolName: "mem.search",
  execution: "local",
  risk: "low",
  requiresApproval: false,
  status: "enabled",
};

const allowSearchForAdults: Policy = {
  id: "pol_search",
  sphereId: "sph_1",
  description: "Adults may search memory.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["memory.search"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

const executor: CapabilityExecutor = {
  async execute(binding, input) {
    return { tool: binding.runtimeToolName, input };
  },
};

// token -> agent identity. The subject is anchored to the credential, never to
// anything the call asserts.
const tokens: Record<string, ResolvedAgentIdentity> = {
  "tok-adult": { agentId: "agt_adult", subject: { agentId: "agt_adult", memberId: "mbr_p", role: "parent", ageProfile: "adult" } },
  "tok-child": { agentId: "agt_child", subject: { agentId: "agt_child", memberId: "mbr_c", role: "child", ageProfile: "child" } },
  // RFC-027: an adult agent scoped to calendar.read only — policy still allows
  // memory.search for its identity, but its declared scope excludes it.
  "tok-scoped-out": { agentId: "agt_so", subject: { agentId: "agt_so", memberId: "mbr_p", role: "parent", ageProfile: "adult" }, scope: ["calendar.read"] },
  "tok-scoped-in": { agentId: "agt_si", subject: { agentId: "agt_si", memberId: "mbr_p", role: "parent", ageProfile: "adult" }, scope: ["memory.search"] },
};

function deps(audit = new InMemoryAuditSink()): SphereMcpDeps {
  let n = 0;
  let a = 0;
  return {
    sphereId: "sph_1",
    resolveAgentByToken: (t) => tokens[t],
    catalog: defaultCapabilityCatalog(),
    bindings: [searchBinding],
    policies: [allowSearchForAdults],
    executor,
    audit,
    newApprovalId: () => `apr_${++a}`,
    newCorrelationId: () => `cor_${++n}`,
    now: () => "2026-06-27T10:00:00.000Z",
  };
}

describe("handleSphereMcpCall (RFC-007 governed gateway)", () => {
  it("refuses an unknown credential before any policy check (deny by default)", async () => {
    const audit = new InMemoryAuditSink();
    const res = await handleSphereMcpCall({ token: "nope", capabilityName: "memory.search" }, deps(audit));
    expect(res.status).toBe("unauthenticated");
    // Recorded as a security fact, with no resolved actor.
    expect(audit.events.some((e) => e.decision === "deny")).toBe(true);
  });

  it("refuses a capability outside the agent's declared scope, before policy (RFC-027)", async () => {
    const audit = new InMemoryAuditSink();
    // policy WOULD allow memory.search for this adult, but the agent is scoped out.
    const res = await handleSphereMcpCall({ token: "tok-scoped-out", capabilityName: "memory.search", input: { q: "x" } }, deps(audit));
    expect(res.status).toBe("denied");
    expect(res.reason).toMatch(/outside the agent's declared scope/i);
    expect(audit.events.some((e) => e.decision === "deny" && /scope/i.test(e.reason ?? ""))).toBe(true);
  });

  it("executes an in-scope, policy-authorized capability (RFC-027)", async () => {
    const res = await handleSphereMcpCall({ token: "tok-scoped-in", capabilityName: "memory.search", input: { q: "x" } }, deps());
    expect(res.status).toBe("ok");
  });

  it("RFC-028: a handler that throws yields a 'failed' result (a clean tool error), never an uncaught throw", async () => {
    const audit = new InMemoryAuditSink();
    const boom: CapabilityExecutor = {
      async execute() {
        throw new Error("Memory item x not found");
      },
    };
    const res = await handleSphereMcpCall(
      { token: "tok-adult", capabilityName: "memory.search", input: { q: "x" } },
      { ...deps(audit), executor: boom },
    );
    expect(res.status).toBe("failed");
    expect(res.reason).toBe("Memory item x not found");
    expect(audit.events.some((e) => e.type === "capability.failed")).toBe(true);
  });

  it("executes a capability the calling agent's identity is authorized for", async () => {
    const res = await handleSphereMcpCall({ token: "tok-adult", capabilityName: "memory.search", input: { q: "x" } }, deps());
    expect(res.status).toBe("ok");
    expect(res.output).toEqual({ tool: "mem.search", input: { q: "x" } });
  });

  it("two tokens on the same gateway see different authorized surfaces", async () => {
    // Same capability/binding, but the child's profile floor denies memory.search? No —
    // memory.search admits child by catalog, but the policy only allows adults.
    const child = await handleSphereMcpCall({ token: "tok-child", capabilityName: "memory.search" }, deps());
    expect(child.status).toBe("denied");
    const adult = await handleSphereMcpCall({ token: "tok-adult", capabilityName: "memory.search" }, deps());
    expect(adult.status).toBe("ok");
  });

  it("denies a capability with no enabled binding (deny by default)", async () => {
    const res = await handleSphereMcpCall({ token: "tok-adult", capabilityName: "payment.execute" }, deps());
    expect(res.status).toBe("denied");
  });

  it("anchors the subject to the credential, ignoring any caller-asserted identity", async () => {
    // Even if the input tries to assert an adult identity, a child token stays a child.
    const res = await handleSphereMcpCall(
      { token: "tok-child", capabilityName: "memory.search", input: { subject: { role: "parent", ageProfile: "adult" } } },
      deps(),
    );
    expect(res.status).toBe("denied");
  });
});
