import { describe, expect, it } from "vitest";

import { executeCapability } from "./resolver.js";
import { defaultCapabilityCatalog } from "./catalog.js";
import type { CapabilityBinding, CapabilityExecutor } from "./types.js";
import { InMemoryAuditSink } from "../audit/events.js";
import type { Policy, PolicyRequest } from "../policy/types.js";

const catalog = defaultCapabilityCatalog();
const adult: PolicyRequest["subject"] = { memberId: "mbr_p1", agentId: "agt_0", role: "parent", ageProfile: "adult" };
const ctx: PolicyRequest["context"] = {
  sphereId: "sph_1",
  time: "2026-06-25T10:00:00.000Z",
  execution: "local",
  correlationId: "cor_chain",
};
const binding: CapabilityBinding = {
  capability: "calendar.create_event",
  runtime: "local",
  runtimeToolName: "local.cal",
  execution: "local",
  risk: "medium",
  requiresApproval: false,
  status: "enabled",
};
const allow: Policy = {
  id: "pol_allow",
  sphereId: "sph_1",
  description: "Adults may create calendar events.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["calendar.create_event"] },
  effect: "allow",
  priority: 0,
  version: 7,
  status: "active",
};
const executor: CapabilityExecutor = { async execute() { return { ok: true }; } };

describe("executeCapability — audit chain (event-model)", () => {
  it("emits requested -> allowed -> executed under one correlation id, with no content", async () => {
    const audit = new InMemoryAuditSink();
    await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", input: { secret: "do not log" }, context: ctx },
      { catalog, bindings: [binding], policies: [allow], executor, audit },
    );

    const chain = audit.byCorrelation("cor_chain");
    expect(chain.map((e) => e.type)).toEqual([
      "capability.requested",
      "capability.allowed",
      "capability.executed",
    ]);
    // deciding policy referenced on the allow event
    const allowed = chain.find((e) => e.type === "capability.allowed");
    expect(allowed?.policyId).toBe("pol_allow");
    expect(allowed?.policyVersion).toBe(7);
    // no private content leaked into any event
    const serialized = JSON.stringify(chain);
    expect(serialized).not.toContain("do not log");
  });

  it("emits requested -> denied when denied", async () => {
    const audit = new InMemoryAuditSink();
    await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx },
      { catalog, bindings: [binding], policies: [], executor, audit }, // no allow -> deny
    );
    expect(audit.byCorrelation("cor_chain").map((e) => e.type)).toEqual([
      "capability.requested",
      "capability.denied",
    ]);
  });
});
