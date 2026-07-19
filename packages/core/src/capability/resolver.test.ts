import { describe, expect, it } from "vitest";

import { executeCapability } from "./resolver.js";
import { defaultCapabilityCatalog } from "./catalog.js";
import type { CapabilityBinding, CapabilityExecutor } from "./types.js";
import type { Policy, PolicyRequest } from "../policy/types.js";

const catalog = defaultCapabilityCatalog();

function binding(over: Partial<CapabilityBinding> = {}): CapabilityBinding {
  return {
    capability: "calendar.create_event",
    runtime: "local",
    runtimeToolName: "local.calendar.create",
    execution: "local",
    risk: "medium",
    requiresApproval: false,
    status: "enabled",
    ...over,
  };
}

function ctx(over: Partial<PolicyRequest["context"]> = {}): PolicyRequest["context"] {
  return {
    sphereId: "sph_1",
    time: "2026-06-25T10:00:00.000Z",
    execution: "local",
    correlationId: "cor_exec",
    ...over,
  };
}

const adult: PolicyRequest["subject"] = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
const child: PolicyRequest["subject"] = { memberId: "mbr_c1", role: "child", ageProfile: "child" };

const allowAdultCalendar: Policy = {
  id: "pol_allow",
  sphereId: "sph_1",
  description: "Adults may create calendar events.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["calendar.create_event"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

function fakeExecutor(): CapabilityExecutor & { calls: number } {
  return {
    calls: 0,
    async execute() {
      this.calls += 1;
      return { ok: true };
    },
  };
}

describe("executeCapability — governance pipeline (ADR-001)", () => {
  it("executes via the binding when policy allows", async () => {
    const executor = fakeExecutor();
    const res = await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", input: { title: "Dentist" }, context: ctx() },
      { catalog, bindings: [binding()], policies: [allowAdultCalendar], executor },
    );
    expect(res.outcome).toBe("executed");
    expect(res.output).toEqual({ ok: true });
    expect(executor.calls).toBe(1);
    expect(res.correlationId).toBe("cor_exec");
  });

  it("denies an unknown capability without calling the executor", async () => {
    const executor = fakeExecutor();
    const res = await executeCapability(
      { subject: adult, capabilityName: "does.not.exist", context: ctx() },
      { catalog, bindings: [], policies: [], executor },
    );
    expect(res.outcome).toBe("denied");
    expect(res.reason).toMatch(/unknown capability/i);
    expect(executor.calls).toBe(0);
  });

  it("denies a profile outside the capability's allowedProfiles (catalog default-deny)", async () => {
    const executor = fakeExecutor();
    // Even with an allow policy, a child is denied calendar.create_event by the catalog floor.
    const res = await executeCapability(
      { subject: child, capabilityName: "calendar.create_event", context: ctx() },
      {
        catalog,
        bindings: [binding()],
        policies: [{ ...allowAdultCalendar, subjectSelector: {} }],
        executor,
      },
    );
    expect(res.outcome).toBe("denied");
    expect(res.reason).toMatch(/profile/i);
    expect(executor.calls).toBe(0);
  });

  it("denies when no enabled binding exists (deny by default)", async () => {
    const executor = fakeExecutor();
    const res = await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx() },
      { catalog, bindings: [binding({ status: "disabled" })], policies: [allowAdultCalendar], executor },
    );
    expect(res.outcome).toBe("denied");
    expect(res.reason).toMatch(/binding/i);
    expect(executor.calls).toBe(0);
  });

  it("requires approval when the policy says so, without executing", async () => {
    const executor = fakeExecutor();
    const approvalPolicy: Policy = {
      ...allowAdultCalendar,
      id: "pol_appr",
      effect: "require_approval",
      approverRoles: ["parent"],
    };
    const res = await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx() },
      { catalog, bindings: [binding()], policies: [approvalPolicy], executor },
    );
    expect(res.outcome).toBe("requires_approval");
    expect(res.decision?.approval?.approverRoles).toEqual(["parent"]);
    expect(executor.calls).toBe(0);
  });

  it("RFC-028: returns outcome 'failed' (not a throw) when the handler throws, recording one capability.failed fact and preserving the error type", async () => {
    const { InMemoryAuditSink } = await import("../audit/events.js");
    const audit = new InMemoryAuditSink();
    class NotFound extends Error {}
    const throwing: CapabilityExecutor = {
      async execute() {
        throw new NotFound("Memory item x not found");
      },
    };
    const res = await executeCapability(
      { subject: adult, capabilityName: "calendar.create_event", context: ctx() },
      { catalog, bindings: [binding()], policies: [allowAdultCalendar], executor: throwing, audit },
    );
    expect(res.outcome).toBe("failed");
    expect(res.reason).toBe("Memory item x not found");
    // The original error is preserved so callers can classify (e.g. 409 vs 422).
    expect(res.error).toBeInstanceOf(NotFound);
    const failed = audit.byCorrelation("cor_exec").filter((e) => e.type === "capability.failed");
    expect(failed).toHaveLength(1);
    // The chain reflects authorization-then-failure, never a bogus "executed".
    const types = audit.byCorrelation("cor_exec").map((e) => e.type);
    expect(types).toContain("capability.allowed");
    expect(types).not.toContain("capability.executed");
  });

  it("raises an allow to approval when the capability has an approval floor", async () => {
    const executor = fakeExecutor();
    // payment.execute has approvalFloor=true in the catalog; allow policy is raised.
    const allowPayment: Policy = {
      id: "pol_pay_allow",
      sphereId: "sph_1",
      description: "adult may pay",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["payment.execute"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    };
    const res = await executeCapability(
      { subject: adult, capabilityName: "payment.execute", context: ctx() },
      {
        catalog,
        bindings: [binding({ capability: "payment.execute", risk: "critical", runtimeToolName: "local.pay" })],
        policies: [allowPayment],
        executor,
      },
    );
    expect(res.outcome).toBe("requires_approval");
    expect(executor.calls).toBe(0);
  });
});
