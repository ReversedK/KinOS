import { describe, expect, it } from "vitest";

import { beginSensitiveAction, resolveApproval } from "./sensitive-action.js";
import { defaultCapabilityCatalog } from "../capability/catalog.js";
import type { CapabilityBinding, CapabilityExecutor } from "../capability/types.js";
import { InMemoryAuditSink } from "../audit/events.js";
import type { Approver } from "../approval/approval.js";
import type { Policy, PolicyRequest } from "../policy/types.js";

const catalog = defaultCapabilityCatalog();
const TIME = "2026-06-25T10:00:00.000Z";

const adult: PolicyRequest["subject"] = { memberId: "mbr_p1", agentId: "agt_0", role: "parent", ageProfile: "adult" };
const parentB: Approver = { memberId: "mbr_p2", roles: ["parent"], ageProfile: "adult" };

const paymentBinding: CapabilityBinding = {
  capability: "payment.execute",
  runtime: "local",
  runtimeToolName: "local.pay",
  execution: "local",
  risk: "critical",
  requiresApproval: false, // catalog approvalFloor=true raises it
  status: "enabled",
};
const allowPayment: Policy = {
  id: "pol_pay",
  sphereId: "sph_1",
  description: "Adult may pay.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["payment.execute"] },
  effect: "allow",
  priority: 0,
  version: 2,
  status: "active",
};

function fakeExecutor() {
  return {
    calls: 0,
    async execute() {
      this.calls += 1;
      return { paid: true };
    },
  } satisfies CapabilityExecutor & { calls: number };
}

/** An executor whose handler throws — the RFC-028 execution-failure case. */
function throwingExecutor(message = "downstream target not found") {
  return {
    calls: 0,
    async execute() {
      this.calls += 1;
      throw new Error(message);
    },
  } satisfies CapabilityExecutor & { calls: number };
}

function ctx(correlationId = "cor_sa"): PolicyRequest["context"] {
  return { sphereId: "sph_1", time: TIME, execution: "local", correlationId };
}

function deps(executor: CapabilityExecutor, audit: InMemoryAuditSink) {
  let n = 0;
  return {
    catalog,
    bindings: [paymentBinding],
    policies: [allowPayment],
    executor,
    audit,
    newApprovalId: () => `apr_${++n}`,
  };
}

describe("sensitive-action flow (ADR-001 + ADR-004 + event-model)", () => {
  it("begins pending approval and emits approval.requested under one correlation id", async () => {
    const executor = fakeExecutor();
    const audit = new InMemoryAuditSink();
    const res = await beginSensitiveAction(
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      deps(executor, audit),
    );

    expect(res.status).toBe("pending_approval");
    expect(res.approval?.state).toBe("pending");
    expect(res.approval?.correlationId).toBe("cor_sa");
    expect(executor.calls).toBe(0);

    const types = audit.byCorrelation("cor_sa").map((e) => e.type);
    expect(types).toContain("capability.requested");
    expect(types).toContain("approval.requested");
  });

  it("executes the one authorized action after a grant, threading the correlation id", async () => {
    const executor = fakeExecutor();
    const audit = new InMemoryAuditSink();
    const d = deps(executor, audit);
    const began = await beginSensitiveAction(
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );

    const res = await resolveApproval(
      began.approval!,
      { approver: parentB, decision: "grant", at: TIME },
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );

    expect(res.status).toBe("executed");
    expect(res.output).toEqual({ paid: true });
    expect(executor.calls).toBe(1);

    const types = audit.byCorrelation("cor_sa").map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["approval.granted", "capability.allowed", "capability.executed"]),
    );
  });

  it("denies after a deny decision without executing", async () => {
    const executor = fakeExecutor();
    const audit = new InMemoryAuditSink();
    const d = deps(executor, audit);
    const began = await beginSensitiveAction(
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );
    const res = await resolveApproval(
      began.approval!,
      { approver: parentB, decision: "deny", at: TIME },
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );
    expect(res.status).toBe("denied");
    expect(executor.calls).toBe(0);
    expect(audit.byCorrelation("cor_sa").map((e) => e.type)).toContain("approval.denied");
  });

  it("RFC-028: a grant whose execution fails is terminal, not a throw — returns the GRANTED approval so it can be persisted (never stranded pending)", async () => {
    const executor = throwingExecutor("Memory item x not found");
    const audit = new InMemoryAuditSink();
    const d = deps(executor, audit);
    const began = await beginSensitiveAction(
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );
    const res = await resolveApproval(
      began.approval!,
      { approver: parentB, decision: "grant", at: TIME },
      { subject: adult, capabilityName: "payment.execute", input: { amount: 20 }, context: ctx() },
      d,
    );

    expect(res.status).toBe("execution_failed");
    expect(res.reason).toBe("Memory item x not found");
    // The grant was a real decision: the approval comes back GRANTED so the caller
    // persists it and it leaves the pending inbox — not left pending to loop forever.
    expect(res.approval?.state).toBe("granted");
    // The failure is a recorded security fact closing the chain.
    const types = audit.byCorrelation("cor_sa").map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["approval.granted", "capability.allowed", "capability.failed"]),
    );
    expect(types).not.toContain("capability.executed");
  });

  it("RFC-028: a direct action whose execution fails returns execution_failed (not a throw) and records capability.failed", async () => {
    const executor = throwingExecutor("boom");
    const audit = new InMemoryAuditSink();
    const calendarBinding: CapabilityBinding = {
      capability: "calendar.create_event",
      runtime: "local",
      runtimeToolName: "local.cal",
      execution: "local",
      risk: "medium",
      requiresApproval: false,
      status: "enabled",
    };
    const allowCal: Policy = { ...allowPayment, id: "pc", resourceSelector: { capabilityNames: ["calendar.create_event"] } };
    const res = await beginSensitiveAction(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx("cor_fail") },
      { catalog, bindings: [calendarBinding], policies: [allowCal], executor, audit, newApprovalId: () => "apr_x" },
    );
    expect(res.status).toBe("execution_failed");
    expect(res.reason).toBe("boom");
    expect(res.error).toBeInstanceOf(Error);
    expect(audit.byCorrelation("cor_fail").map((e) => e.type)).toContain("capability.failed");
  });

  it("executes immediately when no approval is required", async () => {
    const executor = fakeExecutor();
    const audit = new InMemoryAuditSink();
    const calendarBinding: CapabilityBinding = {
      capability: "calendar.create_event",
      runtime: "local",
      runtimeToolName: "local.cal",
      execution: "local",
      risk: "medium",
      requiresApproval: false,
      status: "enabled",
    };
    const allowCal: Policy = { ...allowPayment, id: "pc", resourceSelector: { capabilityNames: ["calendar.create_event"] } };
    const res = await beginSensitiveAction(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx("cor_cal") },
      { catalog, bindings: [calendarBinding], policies: [allowCal], executor, audit, newApprovalId: () => "apr_x" },
    );
    expect(res.status).toBe("executed");
    expect(executor.calls).toBe(1);
  });
});
