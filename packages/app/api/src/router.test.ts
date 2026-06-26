import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySphereStore,
  createApprovalFromDecision,
  createSphere,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
  type PolicyDecision,
} from "@kinos/core";

import { handleApiRequest, type ApiDeps } from "./router.js";

const NOW = "2026-06-25T10:00:00.000Z";

async function deps(): Promise<ApiDeps & { audit: InMemoryAuditSink; approvals: InMemoryApprovalStore }> {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));

  const audit = new InMemoryAuditSink();
  audit.record({ type: "sphere.created", sphereId: "sph_1", resourceId: "sph_1", correlationId: "cor_x", createdAt: NOW });

  const approvals = new InMemoryApprovalStore();
  const decision: PolicyDecision = {
    effect: "require_approval",
    reason: "needs a parent",
    matchedPolicyId: "pol",
    matchedPolicyVersion: 1,
    approval: { approverRoles: ["parent"], expiresInSeconds: 3600 },
    correlationId: "cor_y",
  };
  await approvals.save({
    approval: createApprovalFromDecision({
      id: "apr_1",
      sphereId: "sph_1",
      decision,
      requestedBy: { agentId: "agt_0", onBehalfOf: "mbr_p1" },
      action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "pay" },
      createdAt: NOW,
    }),
    request: {
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      capabilityName: "payment.execute",
      context: { sphereId: "sph_1", time: NOW, execution: "local", correlationId: "cor_y" },
    },
  });

  let n = 0;
  return { store, approvals, audit, newCorrelationId: () => `req_${++n}` };
}

describe("API router (api-contract.md)", () => {
  it("every response carries a correlation id", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/health" }, await deps());
    expect(res.status).toBe(200);
    expect(res.correlationId).toBe("req_1");
  });

  it("lists spheres", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ spheres: ["sph_1"] });
  });

  it("gets a sphere summary", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "sph_1", name: "Doe Family", members: 1 });
  });

  it("returns not_found for a missing sphere (with a correlation id)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/nope" }, await deps());
    expect(res.status).toBe(404);
    expect(res.code).toBe("not_found");
    expect(res.correlationId).toBeTruthy();
  });

  it("lists pending approvals", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/approvals" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pending: [
        { id: "apr_1", sphereId: "sph_1", capability: "payment.execute", state: "pending", approverRoles: ["parent"] },
      ],
    });
  });

  it("returns an audit chain by correlation id", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/audit/cor_x" }, await deps());
    expect(res.status).toBe(200);
    expect((res.body as { events: unknown[] }).events).toHaveLength(1);
  });

  it("rejects a non-GET method", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres" }, await deps());
    expect(res.status).toBe(405);
    expect(res.code).toBe("invalid_request");
  });

  it("returns not_found for an unknown route", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/nope" }, await deps());
    expect(res.status).toBe(404);
  });

  it("lists a sphere's members (role + status, no private content)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/members" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      members: [{ id: "mbr_p1", role: "parent", status: "active" }],
    });
  });

  it("lists a sphere's agents", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/agents" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agents: [] });
  });

  it("404s members of a missing sphere", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/nope/members" }, await deps());
    expect(res.status).toBe(404);
    expect(res.code).toBe("not_found");
  });
});

// --- Governed write path: POST capability execution (api-contract §Capability) ---

describe("API router — capability execution (write path)", () => {
  const allowAdultCalendar: Policy = {
    id: "pol_cal",
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
  const calendarBinding: CapabilityBinding = {
    capability: "calendar.create_event",
    runtime: "local",
    runtimeToolName: "local.calendar",
    execution: "local",
    risk: "medium",
    requiresApproval: false,
    status: "enabled",
  };
  const allowAdultPayment: Policy = {
    ...allowAdultCalendar,
    id: "pol_pay",
    description: "Adults may execute payments.",
    resourceSelector: { capabilityNames: ["payment.execute"] },
  };
  const paymentBinding: CapabilityBinding = {
    ...calendarBinding,
    capability: "payment.execute",
    runtimeToolName: "local.pay",
    risk: "critical",
  };

  async function execDeps(policies: Policy[], bindings: CapabilityBinding[]) {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies, bindings, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    const approvals = new InMemoryApprovalStore();
    let calls = 0;
    const executor: CapabilityExecutor = {
      async execute() {
        calls += 1;
        return { ok: true };
      },
    };
    let n = 0;
    let a = 0;
    const deps: ApiDeps = {
      store,
      approvals,
      audit,
      auditSink: audit,
      executor,
      newCorrelationId: () => `req_${++n}`,
      newApprovalId: () => `apr_${++a}`,
      now: () => NOW,
    };
    return { deps, audit, approvals, calls: () => calls };
  }

  const adult = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" as const };
  const child = { memberId: "mbr_c1", role: "child", ageProfile: "child" as const };
  const execPath = (cap: string) => `/spheres/sph_1/capabilities/${cap}/execute`;

  it("executes an allowed capability (200) and audits it", async () => {
    const { deps, audit, calls } = await execDeps([allowAdultCalendar], [calendarBinding]);
    const res = await handleApiRequest(
      { method: "POST", path: execPath("calendar.create_event"), body: { subject: adult } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "executed" });
    expect(calls()).toBe(1);
    expect(audit.byCorrelation(res.correlationId).map((e) => e.type)).toContain("capability.executed");
  });

  it("denies a child by the catalog profile floor (403 forbidden)", async () => {
    const { deps, calls } = await execDeps([{ ...allowAdultCalendar, subjectSelector: {} }], [calendarBinding]);
    const res = await handleApiRequest(
      { method: "POST", path: execPath("calendar.create_event"), body: { subject: child } },
      deps,
    );
    expect(res.status).toBe(403);
    expect(res.code).toBe("forbidden");
    expect(calls()).toBe(0);
  });

  it("returns 202 approval_required for an approval-floored capability and persists the approval", async () => {
    const { deps, approvals, calls } = await execDeps([allowAdultPayment], [paymentBinding]);
    const res = await handleApiRequest(
      { method: "POST", path: execPath("payment.execute"), body: { subject: adult } },
      deps,
    );
    expect(res.status).toBe(202);
    expect(res.code).toBe("approval_required");
    expect(res.body).toMatchObject({ status: "pending_approval" });
    expect(calls()).toBe(0);
    expect(await approvals.listPending("sph_1")).toHaveLength(1);
  });

  it("404s execution against a missing sphere", async () => {
    const { deps } = await execDeps([], []);
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/nope/capabilities/calendar.create_event/execute", body: { subject: adult } },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("rejects execution without a subject (400 invalid_request)", async () => {
    const { deps } = await execDeps([allowAdultCalendar], [calendarBinding]);
    const res = await handleApiRequest(
      { method: "POST", path: execPath("calendar.create_event"), body: {} },
      deps,
    );
    expect(res.status).toBe(400);
    expect(res.code).toBe("invalid_request");
  });

  it("returns 501 when execution is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest(
      { method: "POST", path: execPath("calendar.create_event"), body: { subject: adult } },
      await deps(),
    );
    expect(res.status).toBe(501);
  });
});
