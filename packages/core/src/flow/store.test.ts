import { describe, expect, it } from "vitest";

import { InMemoryApprovalStore, type PendingSensitiveAction } from "./store.js";
import { createApprovalFromDecision } from "../approval/approval.js";
import type { CapabilityExecutionRequest } from "../capability/resolver.js";
import type { PolicyDecision } from "../policy/types.js";

const NOW = "2026-06-25T10:00:00.000Z";

function decision(): PolicyDecision {
  return {
    effect: "require_approval",
    reason: "needs a parent",
    matchedPolicyId: "pol",
    matchedPolicyVersion: 1,
    approval: { approverRoles: ["parent"], expiresInSeconds: 3600 },
    correlationId: "cor_1",
  };
}

function pending(id: string, sphereId = "sph_1"): PendingSensitiveAction {
  const approval = createApprovalFromDecision({
    id,
    sphereId,
    decision: decision(),
    requestedBy: { agentId: "agt_0", onBehalfOf: "mbr_p1" },
    action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "pay" },
    createdAt: NOW,
  });
  const request: CapabilityExecutionRequest = {
    subject: { memberId: "mbr_p1", agentId: "agt_0", role: "parent", ageProfile: "adult" },
    capabilityName: "payment.execute",
    input: { amount: 20 },
    context: { sphereId, time: NOW, execution: "local", correlationId: "cor_1" },
  };
  return { approval, request };
}

describe("InMemoryApprovalStore", () => {
  it("saves and loads a pending action by approval id", async () => {
    const store = new InMemoryApprovalStore();
    await store.save(pending("apr_1"));
    const loaded = await store.load("apr_1");
    expect(loaded?.approval.id).toBe("apr_1");
    expect(loaded?.request.capabilityName).toBe("payment.execute");
  });

  it("returns undefined for a missing id", async () => {
    expect(await new InMemoryApprovalStore().load("nope")).toBeUndefined();
  });

  it("lists only pending actions, optionally by sphere", async () => {
    const store = new InMemoryApprovalStore();
    await store.save(pending("apr_1", "sph_1"));
    await store.save(pending("apr_2", "sph_2"));
    // resolve apr_1 by saving a non-pending version
    const resolved = pending("apr_1", "sph_1");
    await store.save({ ...resolved, approval: { ...resolved.approval, state: "granted" } });

    const allPending = await store.listPending();
    expect(allPending.map((p) => p.approval.id)).toEqual(["apr_2"]);
    expect(await store.listPending("sph_1")).toHaveLength(0);
  });

  it("deletes and isolates stored data from later mutation", async () => {
    const store = new InMemoryApprovalStore();
    const p = pending("apr_1");
    await store.save(p);
    (p.request.input as { amount: number }).amount = 999;
    expect((await store.load("apr_1"))?.request.input).toEqual({ amount: 20 });

    await store.delete("apr_1");
    expect(await store.load("apr_1")).toBeUndefined();
  });
});
