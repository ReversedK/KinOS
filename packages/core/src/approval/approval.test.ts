import { describe, expect, it } from "vitest";

import {
  cancelApproval,
  createApprovalFromDecision,
  expireIfDue,
  isAuthorized,
  recordApprovalDecision,
  type Approver,
} from "./approval.js";
import type { PolicyDecision } from "../policy/types.js";

const CREATED = "2026-06-25T10:00:00.000Z";

function approvalDecision(over: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    effect: "require_approval",
    reason: "Critical financial action requires a parent's approval.",
    matchedPolicyId: "pol_payment",
    matchedPolicyVersion: 3,
    approval: { approverRoles: ["parent"], expiresInSeconds: 3600 },
    correlationId: "cor_pay_1",
    ...over,
  };
}

function pendingApproval(quorum = 1) {
  return createApprovalFromDecision({
    id: "apr_1",
    sphereId: "sph_1",
    decision: approvalDecision(),
    requestedBy: { agentId: "agt_c1", onBehalfOf: "mbr_c1" },
    action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "Pay 20€" },
    createdAt: CREATED,
    quorum,
  });
}

const parentA: Approver = { memberId: "mbr_p1", roles: ["parent"], ageProfile: "adult" };
const parentB: Approver = { memberId: "mbr_p2", roles: ["parent"], ageProfile: "adult" };
const childRequester: Approver = { memberId: "mbr_c1", roles: ["child"], ageProfile: "child" };

describe("createApprovalFromDecision (ADR-004)", () => {
  it("creates exactly one pending request carrying the originating correlation id", () => {
    const a = pendingApproval();
    expect(a.state).toBe("pending");
    expect(a.correlationId).toBe("cor_pay_1");
    expect(a.matchedPolicyId).toBe("pol_payment");
    expect(a.matchedPolicyVersion).toBe(3);
    expect(a.approverRoles).toEqual(["parent"]);
    expect(a.quorum).toBe(1);
    expect(a.expiresAt).toBe("2026-06-25T11:00:00.000Z"); // +3600s
    expect(a.decisions).toEqual([]);
  });

  it("refuses a decision that is not require_approval", () => {
    expect(() =>
      createApprovalFromDecision({
        id: "apr_x",
        sphereId: "sph_1",
        decision: approvalDecision({ effect: "allow", approval: undefined }),
        requestedBy: { agentId: "agt_c1", onBehalfOf: "mbr_c1" },
        action: { capabilityName: "x.y", riskLevel: "low", summary: "s" },
        createdAt: CREATED,
      }),
    ).toThrow(/require_approval/);
  });
});

describe("Who may approve (separation of duties; minors excluded)", () => {
  it("grants when an eligible parent approves (quorum 1)", () => {
    const a = recordApprovalDecision(pendingApproval(), {
      approver: parentA,
      decision: "grant",
      at: "2026-06-25T10:05:00.000Z",
    });
    expect(a.state).toBe("granted");
    expect(isAuthorized(a)).toBe(true);
  });

  it("rejects an approver lacking the required role", () => {
    const guest: Approver = { memberId: "mbr_g", roles: ["guest"], ageProfile: "adult" };
    expect(() =>
      recordApprovalDecision(pendingApproval(), { approver: guest, decision: "grant", at: CREATED }),
    ).toThrow(/role/i);
  });

  it("rejects the requester approving their own request (separation of duties)", () => {
    // a parent who is also the on-behalf-of subject cannot self-approve
    const selfReq = createApprovalFromDecision({
      id: "apr_self",
      sphereId: "sph_1",
      decision: approvalDecision(),
      requestedBy: { agentId: "agt_p1", onBehalfOf: "mbr_p1" },
      action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "s" },
      createdAt: CREATED,
    });
    expect(() =>
      recordApprovalDecision(selfReq, { approver: parentA, decision: "grant", at: CREATED }),
    ).toThrow(/own request|separation/i);
  });

  it("rejects a minor approving", () => {
    expect(() =>
      recordApprovalDecision(pendingApproval(), {
        approver: childRequester,
        decision: "grant",
        at: CREATED,
      }),
    ).toThrow(/minor/i);
  });
});

describe("Quorum and deny dominance", () => {
  it("requires quorum distinct grants to grant", () => {
    let a = pendingApproval(2);
    a = recordApprovalDecision(a, { approver: parentA, decision: "grant", at: CREATED });
    expect(a.state).toBe("pending");
    a = recordApprovalDecision(a, { approver: parentB, decision: "grant", at: CREATED });
    expect(a.state).toBe("granted");
  });

  it("does not count a duplicate decision by the same approver twice", () => {
    let a = pendingApproval(2);
    a = recordApprovalDecision(a, { approver: parentA, decision: "grant", at: CREATED });
    a = recordApprovalDecision(a, { approver: parentA, decision: "grant", at: CREATED });
    expect(a.state).toBe("pending");
    expect(a.decisions).toHaveLength(1);
  });

  it("resolves as denied on a single deny", () => {
    const a = recordApprovalDecision(pendingApproval(2), {
      approver: parentA,
      decision: "deny",
      at: CREATED,
    });
    expect(a.state).toBe("denied");
    expect(isAuthorized(a)).toBe(false);
  });
});

describe("Expiry and cancellation (fail closed)", () => {
  it("expires a pending request past expiresAt and resolves as a denial", () => {
    const a = expireIfDue(pendingApproval(), "2026-06-25T11:00:00.001Z");
    expect(a.state).toBe("expired");
    expect(isAuthorized(a)).toBe(false);
  });

  it("does not expire before expiresAt", () => {
    const a = expireIfDue(pendingApproval(), "2026-06-25T10:59:59.000Z");
    expect(a.state).toBe("pending");
  });

  it("cancels a pending request", () => {
    const a = cancelApproval(pendingApproval(), "2026-06-25T10:10:00.000Z");
    expect(a.state).toBe("cancelled");
    expect(isAuthorized(a)).toBe(false);
  });

  it("refuses to record a decision on a resolved request", () => {
    const granted = recordApprovalDecision(pendingApproval(), {
      approver: parentA,
      decision: "grant",
      at: CREATED,
    });
    expect(() =>
      recordApprovalDecision(granted, { approver: parentB, decision: "grant", at: CREATED }),
    ).toThrow(/pending/i);
  });
});
