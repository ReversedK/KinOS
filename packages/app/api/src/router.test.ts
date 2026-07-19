import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySessionStore,
  InMemorySphereStore,
  createAgent,
  createApprovalFromDecision,
  createIntegration,
  createSphere,
  TuiTicketStore,
  defaultAdminPolicies,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
  type PolicyDecision,
} from "@kinos/core";

import { handleApiRequest, type ApiDeps } from "./router.js";
import { FakeAuthBroker, PendingOAuthStore } from "./oauth.js";

const NOW = "2026-06-25T10:00:00.000Z";

/**
 * The RFC-008 admin_provisioning seed — the lineage marker proving a Sphere was
 * created by governed provisioning. The admin seed backfill is anchored on it, so
 * a Sphere that predates a newer seed still gets it while a Sphere with no
 * policies is left denied by default.
 */
function adminProvisioningSeed(sphereId: string): Policy {
  const seed = defaultAdminPolicies(sphereId).find((p) => p.id === `pol_${sphereId}_admin_provisioning`);
  if (seed === undefined) throw new Error("admin_provisioning seed not found");
  return seed;
}

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

  it("exposes the read-only capability catalog (name/risk/profiles), no raw tool ids", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/capabilities" }, await deps());
    expect(res.status).toBe(200);
    const caps = (res.body as { capabilities: Array<{ name: string; risk: string }> }).capabilities;
    expect(caps.some((c) => c.name === "memory.search")).toBe(true);
    expect(caps.some((c) => c.name === "sphere.create")).toBe(true);
    // Never leaks binding/runtime tool names.
    expect(JSON.stringify(caps)).not.toContain("runtimeToolName");
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
        {
          id: "apr_1",
          sphereId: "sph_1",
          capability: "payment.execute",
          correlationId: "cor_y",
          summary: "pay",
          risk: "critical",
          requestedByAgent: "agt_0",
          onBehalfOf: "mbr_p1",
          state: "pending",
          approverRoles: ["parent"],
          createdAt: NOW,
          expiresAt: "2026-06-25T11:00:00.000Z",
        },
      ],
    });
  });

  it("returns an audit chain by correlation id", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/audit/cor_x" }, await deps());
    expect(res.status).toBe(200);
    expect((res.body as { events: unknown[] }).events).toHaveLength(1);
  });

  // RFC-020: the Sphere activity tail.
  describe("GET /spheres/:id/audit", () => {
    it("returns the Sphere's recent events, newest first", async () => {
      const d = await deps();
      d.audit.record({ type: "capability.executed", sphereId: "sph_1", decision: "executed", correlationId: "cor_z", createdAt: NOW });
      const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/audit" }, d);
      expect(res.status).toBe(200);
      expect((res.body as { events: { type: string }[] }).events.map((e) => e.type)).toEqual([
        "capability.executed",
        "sphere.created",
      ]);
    });

    it("honours limit and caps it (an audit read must not drain the log)", async () => {
      const d = await deps();
      for (let i = 0; i < 5; i += 1) {
        d.audit.record({ type: "capability.executed", sphereId: "sph_1", correlationId: `cor_${i}`, createdAt: NOW });
      }
      const limited = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/audit", query: { limit: "2" } }, d);
      expect((limited.body as { events: unknown[] }).events).toHaveLength(2);

      // Over the cap: served, but never more than AUDIT_MAX_LIMIT (200).
      const huge = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/audit", query: { limit: "100000" } }, d);
      expect((huge.body as { events: unknown[] }).events.length).toBeLessThanOrEqual(200);

      // Garbage falls back to the default rather than returning nothing.
      const junk = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/audit", query: { limit: "abc" } }, d);
      expect((junk.body as { events: unknown[] }).events).toHaveLength(6);
    });

    it("returns not_found for an unknown Sphere", async () => {
      const res = await handleApiRequest({ method: "GET", path: "/spheres/nope/audit" }, await deps());
      expect(res.status).toBe(404);
      expect(res.code).toBe("not_found");
    });
  });

  it("rejects a non-GET method on a read-only route", async () => {
    // POST /spheres is now the governed provisioning route (RFC-008); use a
    // genuinely GET-only read route (members) to exercise the method guard.
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/members" }, await deps());
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

  it("reports a sphere's resolved runtime profile (local-first default)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/runtime" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: "ollama",
      execution: "local",
      cloudInferenceEnabled: false,
      allowed: true,
      // Hermes is the sole Harness; the provider/model are the governed ones.
      harness: { runtime: "hermes", provider: "ollama", model: "gemma4-128k" },
    });
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

  it("runs runtime.config.project through the pipeline: approval floor (202) then grant executes (RFC-007)", async () => {
    // No sphere binding for runtime.config.project — the router injects the
    // runtime-governance binding, so the pipeline resolves + executes it.
    const allowProject: Policy = {
      ...allowAdultCalendar,
      id: "pol_project",
      description: "Adults may project agent runtime config.",
      resourceSelector: { capabilityNames: ["runtime.config.project"] },
    };
    const { deps, approvals, calls } = await execDeps([allowProject], []);
    const begin = await handleApiRequest(
      { method: "POST", path: execPath("runtime.config.project"), body: { subject: adult, input: { sphereId: "sph_1", agentId: "agt_0" } } },
      deps,
    );
    expect(begin.status).toBe(202); // catalog approval floor for runtime.config.project
    expect(calls()).toBe(0);
    expect(await approvals.listPending("sph_1")).toHaveLength(1);

    const grant = await handleApiRequest(
      // A different parent approves (self-approval is forbidden).
      { method: "POST", path: "/approvals/apr_1/grant", body: { approver: { memberId: "mbr_p2", role: "parent" } } },
      deps,
    );
    expect(grant.status).toBe(200);
    expect(grant.body).toMatchObject({ capability: "runtime.config.project", status: "executed" });
    expect(calls()).toBe(1); // the runtime.project executor tool ran on grant
  });

  it("backfills the default admin runtime-governance seed for runtime.config.project execution when missing from the snapshot", async () => {
    // A Sphere provisioned before the runtime-governance seed existed: it still
    // carries the admin_provisioning seed, which is the lineage the backfill is
    // anchored on. A Sphere with no policies at all is never backfilled.
    const { deps, approvals, calls } = await execDeps([adminProvisioningSeed("sph_1")], []);
    const begin = await handleApiRequest(
      { method: "POST", path: execPath("runtime.config.project"), body: { subject: adult, input: { sphereId: "sph_1", agentId: "agt_0" } } },
      deps,
    );
    expect(begin.status).toBe(202);
    expect(calls()).toBe(0);
    expect(await approvals.listPending("sph_1")).toHaveLength(1);
  });

  it("runtime.session.backup executes directly (no approval floor) and surfaces its output", async () => {
    const allowBackup: Policy = {
      ...allowAdultCalendar,
      id: "pol_bk",
      resourceSelector: { capabilityNames: ["runtime.session.backup"] },
    };
    const { deps, calls } = await execDeps([allowBackup], []);
    const res = await handleApiRequest(
      { method: "POST", path: execPath("runtime.session.backup"), body: { subject: adult, input: { sphereId: "sph_1", agentId: "agt_0" } } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "executed" });
    expect((res.body as { output?: unknown }).output).toBeDefined();
    expect(calls()).toBe(1);
  });

  it("runtime.session.restore is approval-gated (202) then grant executes", async () => {
    const allowRestore: Policy = {
      ...allowAdultCalendar,
      id: "pol_rs",
      resourceSelector: { capabilityNames: ["runtime.session.restore"] },
    };
    const { deps, calls } = await execDeps([allowRestore], []);
    const begin = await handleApiRequest(
      { method: "POST", path: execPath("runtime.session.restore"), body: { subject: adult, input: { sphereId: "sph_1", agentId: "agt_0", snapshotId: "snap_1" } } },
      deps,
    );
    expect(begin.status).toBe(202);
    expect(calls()).toBe(0);
    const grant = await handleApiRequest(
      { method: "POST", path: "/approvals/apr_1/grant", body: { approver: { memberId: "mbr_p2", role: "parent" } } },
      deps,
    );
    expect(grant.status).toBe(200);
    expect(grant.body).toMatchObject({ capability: "runtime.session.restore", status: "executed" });
    expect(calls()).toBe(1);
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

// --- Governed write path: POST approval grant/deny (api-contract §Approval) ---

describe("API router — approval resolution (write path)", () => {
  const allowAdultPayment: Policy = {
    id: "pol_pay",
    sphereId: "sph_1",
    description: "Adults may execute payments.",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["payment.execute"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };
  const paymentBinding: CapabilityBinding = {
    capability: "payment.execute",
    runtime: "local",
    runtimeToolName: "local.pay",
    execution: "local",
    risk: "critical",
    requiresApproval: false,
    status: "enabled",
  };

  async function approvalDeps() {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    await store.save(
      exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [allowAdultPayment], bindings: [paymentBinding], exportedAt: NOW }),
    );
    const approvals = new InMemoryApprovalStore();
    const decision: PolicyDecision = {
      effect: "require_approval",
      reason: "payment needs a parent",
      matchedPolicyId: "pol_pay",
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
        input: {},
        context: { sphereId: "sph_1", time: NOW, execution: "local", correlationId: "cor_y" },
      },
    });
    const audit = new InMemoryAuditSink();
    let calls = 0;
    const executor: CapabilityExecutor = {
      async execute() {
        calls += 1;
        return { paid: true };
      },
    };
    let n = 0;
    const deps: ApiDeps = {
      store,
      approvals,
      audit,
      auditSink: audit,
      executor,
      newCorrelationId: () => `req_${++n}`,
      newApprovalId: () => "apr_1",
      now: () => NOW,
    };
    return { deps, approvals, calls: () => calls };
  }

  const parentApprover = { approver: { memberId: "mbr_p2", role: "parent" } };

  it("grant resumes the authorized action (200 executed)", async () => {
    const { deps, calls } = await approvalDeps();
    const res = await handleApiRequest(
      { method: "POST", path: "/approvals/apr_1/grant", body: parentApprover },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approvalId: "apr_1", status: "executed" });
    expect(calls()).toBe(1);
  });

  it("deny records a denial and executes nothing (200 denied)", async () => {
    const { deps, calls } = await approvalDeps();
    const res = await handleApiRequest(
      { method: "POST", path: "/approvals/apr_1/deny", body: parentApprover },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "denied" });
    expect(calls()).toBe(0);
  });

  it("404s an unknown approval", async () => {
    const { deps } = await approvalDeps();
    const res = await handleApiRequest({ method: "POST", path: "/approvals/nope/grant", body: parentApprover }, deps);
    expect(res.status).toBe(404);
  });

  it("rejects a missing approver (400)", async () => {
    const { deps } = await approvalDeps();
    const res = await handleApiRequest({ method: "POST", path: "/approvals/apr_1/grant", body: {} }, deps);
    expect(res.status).toBe(400);
  });

  it("409s an already-resolved approval", async () => {
    const { deps } = await approvalDeps();
    await handleApiRequest({ method: "POST", path: "/approvals/apr_1/grant", body: parentApprover }, deps);
    const again = await handleApiRequest({ method: "POST", path: "/approvals/apr_1/grant", body: parentApprover }, deps);
    expect(again.status).toBe(409);
  });

  it("501 when resolution is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/approvals/apr_1/grant", body: parentApprover }, await deps());
    expect(res.status).toBe(501);
  });
});

// --- Governed settings write: POST /spheres/:id/runtime (RFC-004) ---

describe("API router — runtime provider/model write", () => {
  const allowAdultSetProvider: Policy = {
    id: "pol_rt",
    sphereId: "sph_1",
    description: "Adults may change the inference provider.",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["runtime.set_provider"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };

  async function runtimeDeps(policies: Policy[]) {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    let n = 0;
    const deps: ApiDeps = {
      store,
      approvals: new InMemoryApprovalStore(),
      audit,
      auditSink: audit,
      newCorrelationId: () => `req_${++n}`,
      now: () => NOW,
    };
    return { deps, audit };
  }

  const adult = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" as const };
  const child = { memberId: "mbr_c1", role: "child", ageProfile: "child" as const };
  const path = "/spheres/sph_1/runtime";

  it("sets the provider/model when policy allows, and persists it", async () => {
    const { deps } = await runtimeDeps([allowAdultSetProvider]);
    const res = await handleApiRequest(
      { method: "POST", path, body: { subject: adult, profile: { providerId: "ollama", model: "mistral", execution: "local" } } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "executed", provider: "ollama", model: "mistral" });
    const after = await handleApiRequest({ method: "GET", path }, deps);
    expect(after.body).toMatchObject({ model: "mistral" });
  });

  it("denies by default when no policy allows it (403)", async () => {
    const { deps } = await runtimeDeps([]);
    const res = await handleApiRequest(
      { method: "POST", path, body: { subject: adult, profile: { providerId: "ollama", model: "mistral", execution: "local" } } },
      deps,
    );
    expect(res.status).toBe(403);
    expect(res.code).toBe("forbidden");
  });

  it("denies a minor by the catalog profile floor even if a policy is permissive (403)", async () => {
    const { deps } = await runtimeDeps([{ ...allowAdultSetProvider, subjectSelector: {} }]);
    const res = await handleApiRequest(
      { method: "POST", path, body: { subject: child, profile: { providerId: "ollama", model: "mistral", execution: "local" } } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("refuses switching to a provider the Sphere does not allow (403)", async () => {
    const { deps } = await runtimeDeps([allowAdultSetProvider]);
    const res = await handleApiRequest(
      {
        method: "POST",
        path,
        body: { subject: adult, profile: { providerId: "openai", model: "gpt-4o-mini", execution: "cloud", secretRef: "secret://k" } },
      },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a missing profile (400)", async () => {
    const { deps } = await runtimeDeps([allowAdultSetProvider]);
    const res = await handleApiRequest({ method: "POST", path, body: { subject: adult } }, deps);
    expect(res.status).toBe(400);
  });

  it("501 when runtime configuration is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest(
      { method: "POST", path, body: { subject: adult, profile: { providerId: "ollama", model: "mistral", execution: "local" } } },
      await deps(),
    );
    expect(res.status).toBe(501);
  });
});

// --- Chat sessions: create + list (RFC-005) ---

describe("API router — chat sessions", () => {
  async function sessionDeps() {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));
    let n = 0;
    let s = 0;
    const deps: ApiDeps = {
      store,
      approvals: new InMemoryApprovalStore(),
      audit: new InMemoryAuditSink(),
      sessions: new InMemorySessionStore(),
      runtime: {
        async listModels() {
          return ["test-model"];
        },
        async generate(request) {
          return { model: request.model, content: "hello back" };
        },
        async isAvailable() {
          return true;
        },
      },
      newCorrelationId: () => `req_${++n}`,
      newSessionId: () => `ses_${++s}`,
      now: () => NOW,
    };
    return deps;
  }

  const owner = { subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" }, agentId: "agt_1", title: "Plans" };

  it("creates a session owned by the subject", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: owner }, await sessionDeps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "ses_1", title: "Plans", agentId: "agt_1", ownerId: "mbr_p1", state: "active" });
  });

  it("lists an owner's session summaries without message content", async () => {
    const deps = await sessionDeps();
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: owner }, deps);
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/sessions", query: { ownerId: "mbr_p1" } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessions: [{ id: "ses_1", title: "Plans", agentId: "agt_1", state: "active", updatedAt: NOW, messageCount: 0 }],
    });
  });

  it("requires ownerId to list (400)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/sessions" }, await sessionDeps());
    expect(res.status).toBe(400);
  });

  it("requires subject.memberId and agentId to create (400)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: { subject: {} } }, await sessionDeps());
    expect(res.status).toBe(400);
  });

  it("404s creating a session in a missing sphere", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/nope/sessions", body: owner }, await sessionDeps());
    expect(res.status).toBe(404);
  });

  it("501 when chat sessions are not enabled (read-only deps)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: owner }, await deps());
    expect(res.status).toBe(501);
  });

  async function withSession() {
    const deps = await sessionDeps();
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: owner }, deps);
    return deps; // session ses_1 now exists, owned by mbr_p1
  }

  const ownerSubject = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
  const turnPath = "/spheres/sph_1/sessions/ses_1/messages";

  it("posts a chat turn and returns the reply (owner)", async () => {
    const deps = await withSession();
    const res = await handleApiRequest(
      { method: "POST", path: turnPath, body: { subject: ownerSubject, text: "what's on today?" } },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: "ses_1", reply: "hello back", messageCount: 2 });
    // persisted
    const read = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/sessions", query: { ownerId: "mbr_p1" } }, deps);
    expect((read.body as { sessions: { messageCount: number }[] }).sessions[0]?.messageCount).toBe(2);
  });

  it("refuses a turn from a non-owner (403)", async () => {
    const deps = await withSession();
    const res = await handleApiRequest(
      { method: "POST", path: turnPath, body: { subject: { memberId: "mbr_p2", role: "parent", ageProfile: "adult" }, text: "hi" } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("surfaces a runtime failure as 502, not a masked 403 (owner is authorized)", async () => {
    const deps = await withSession();
    deps.runtime = {
      async listModels() {
        return ["test-model"];
      },
      async generate() {
        throw new Error("Ollama /api/chat failed: 500 Internal Server Error");
      },
      async isAvailable() {
        return true;
      },
    };
    const res = await handleApiRequest(
      { method: "POST", path: turnPath, body: { subject: ownerSubject, text: "hi" } },
      deps,
    );
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "runtime_error" });
    expect((res.body as { message: string }).message).toContain("Ollama /api/chat failed");
  });

  it("404s a turn on a missing session", async () => {
    const deps = await withSession();
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/sessions/nope/messages", body: { subject: ownerSubject, text: "hi" } },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("rejects an empty text (400)", async () => {
    const deps = await withSession();
    const res = await handleApiRequest({ method: "POST", path: turnPath, body: { subject: ownerSubject, text: "  " } }, deps);
    expect(res.status).toBe(400);
  });

  it("501 for a chat turn when chat is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest({ method: "POST", path: turnPath, body: { subject: ownerSubject, text: "hi" } }, await deps());
    expect(res.status).toBe(501);
  });

  it("reads one session with its transcript for the owner (member role derived from the Sphere)", async () => {
    const deps = await withSession();
    await handleApiRequest({ method: "POST", path: turnPath, body: { subject: ownerSubject, text: "hi there" } }, deps);
    const res = await handleApiRequest(
      { method: "GET", path: "/spheres/sph_1/sessions/ses_1", query: { ownerId: "mbr_p1" } },
      deps,
    );
    expect(res.status).toBe(200);
    const body = res.body as { id: string; messages: { role: string; content: string }[] };
    expect(body.id).toBe("ses_1");
    expect(body.messages.map((m) => m.role)).toEqual(["user", "agent"]);
    expect(body.messages[0]?.content).toBe("hi there");
  });

  it("denies reading a session to a non-member (403)", async () => {
    const deps = await withSession();
    const res = await handleApiRequest(
      { method: "GET", path: "/spheres/sph_1/sessions/ses_1", query: { ownerId: "mbr_stranger" } },
      deps,
    );
    expect(res.status).toBe(403);
  });
});

// --- Connectors: list + governed enable/disable (integration-model) ---

describe("API router — integrations", () => {
  const allowAdultEnable: Policy = {
    id: "pol_int",
    sphereId: "sph_1",
    description: "Adults may manage connectors.",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["integration.enable", "integration.disable"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };

  async function intDeps(policies: Policy[]) {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const integrations = [
      createIntegration({ id: "int_1", sphereId: "sph_1", provider: "google", scopes: ["calendar.read"], secretRef: "secret://g", providesCapabilities: ["calendar.create_event"] }),
    ];
    await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies, integrations, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    let n = 0;
    const deps: ApiDeps = {
      store,
      approvals: new InMemoryApprovalStore(),
      audit,
      auditSink: audit,
      newCorrelationId: () => `req_${++n}`,
      now: () => NOW,
    };
    return deps;
  }

  const adult = { subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" } };
  const child = { subject: { memberId: "mbr_c1", role: "child", ageProfile: "child" } };

  it("lists integration summaries without the secret reference value path", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/integrations" }, await intDeps([]));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      integrations: [{ id: "int_1", provider: "google", status: "proposed", scopes: ["calendar.read"], providesCapabilities: ["calendar.create_event"], configured: true }],
    });
  });

  it("enables an integration when policy allows, and persists it", async () => {
    const deps = await intDeps([allowAdultEnable]);
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/int_1/enable", body: adult }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "int_1", status: "enabled" });
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/integrations" }, deps);
    expect((list.body as { integrations: { status: string }[] }).integrations[0]?.status).toBe("enabled");
  });

  it("denies enabling by default when no policy allows it (403)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/int_1/enable", body: adult }, await intDeps([]));
    expect(res.status).toBe(403);
  });

  it("denies a minor by the catalog profile floor (403)", async () => {
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/integrations/int_1/enable", body: child },
      await intDeps([{ ...allowAdultEnable, subjectSelector: {} }]),
    );
    expect(res.status).toBe(403);
  });

  it("404s an unknown integration", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/nope/enable", body: adult }, await intDeps([allowAdultEnable]));
    expect(res.status).toBe(404);
  });

  it("501 when integration management is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/int_1/enable", body: adult }, await deps());
    expect(res.status).toBe(501);
  });
});

// --- Store: browse + governed install/enable (RFC-002) ---

describe("API router — package store", () => {
  const allowAdultPackages: Policy = {
    id: "pol_pkg",
    sphereId: "sph_1",
    description: "Adults may manage packages.",
    subjectSelector: { ageProfiles: ["adult"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["package.install", "package.enable", "package.disable"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };

  async function pkgDeps(policies: Policy[]) {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    let n = 0;
    const deps: ApiDeps = {
      store,
      approvals: new InMemoryApprovalStore(),
      audit,
      auditSink: audit,
      newCorrelationId: () => `req_${++n}`,
      now: () => NOW,
    };
    return deps;
  }

  const adult = { subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" } };

  it("browses the curated store catalog", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/store" }, await pkgDeps([]));
    expect(res.status).toBe(200);
    const pkgs = (res.body as { packages: { id: string }[] }).packages;
    expect(pkgs.some((p) => p.id === "minecraft-themepark")).toBe(true);
  });

  it("installs a store package (installed, not enabled — install != authorization) and persists it", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "family-calendar", status: "installed" });
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/packages" }, deps);
    expect((list.body as { packages: { id: string; status: string }[] }).packages).toEqual([
      { id: "family-calendar", type: "skill", title: "Family Calendar", description: expect.any(String), status: "installed" },
    ]);
  });

  it("then enables the installed package", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/enable", body: adult }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "family-calendar", status: "enabled" });
  });

  it("installs absent dependencies (RFC-002 resolve + dedup)", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "minecraft-themepark" } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "minecraft-themepark", installed: ["minecraft-mcp", "minecraft-themepark"] });
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/packages" }, deps);
    expect((list.body as { packages: { id: string }[] }).packages.map((p) => p.id).sort()).toEqual(["minecraft-mcp", "minecraft-themepark"]);
  });

  it("denies install by default when no policy allows it (403)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, await pkgDeps([]));
    expect(res.status).toBe(403);
  });

  it("404s installing a package not in the store", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "nope" } }, await pkgDeps([allowAdultPackages]));
    expect(res.status).toBe(404);
  });

  it("409s installing an already-installed package", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    const again = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    expect(again.status).toBe(409);
  });

  it("501 when package management is not enabled (read-only deps)", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, await deps());
    expect(res.status).toBe(501);
  });

  // RFC-016: an integration package creates a configurable Integration; configuring
  // it sets provider + a secret reference (never the value) + scopes.
  it("installing an integration package creates a proposed Integration in the connectors", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/integrations" }, deps);
    const integrations = (list.body as { integrations: { id: string; provider: string; status: string }[] }).integrations;
    expect(integrations).toEqual([
      { id: "int_google-calendar", provider: "google", status: "proposed", scopes: expect.any(Array), providesCapabilities: ["calendar.read", "calendar.create_event"], auth: "oauth", configured: false },
    ]);
  });

  it("integration.configure sets provider + secret reference + scopes; never leaks the secret", async () => {
    const configPolicy: Policy = {
      id: "pol_cfg",
      sphereId: "sph_1",
      description: "Adults may configure integrations.",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["integration.configure"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    };
    const deps = await pkgDeps([allowAdultPackages, configPolicy]);
    const audit = deps.audit as InMemoryAuditSink;
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);
    const res = await handleApiRequest(
      {
        method: "POST",
        path: "/spheres/sph_1/integrations/int_google-calendar/configure",
        body: { ...adult, provider: "caldav", secretRef: "secret://caldav/sph_1", scopes: ["calendar.read"] },
      },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "int_google-calendar", provider: "caldav", configured: true });
    // Never expose the reference value or any secret in the read surface / audit.
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/integrations" }, deps);
    expect(JSON.stringify(list.body)).not.toContain("secret://caldav/sph_1");
    expect(JSON.stringify(audit.events)).not.toContain("secret://caldav/sph_1");
  });

  it("integration.configure rejects a raw credential value (must be a reference)", async () => {
    const configPolicy: Policy = {
      id: "pol_cfg2",
      sphereId: "sph_1",
      description: "Adults may configure integrations.",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["integration.configure"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    };
    const deps = await pkgDeps([allowAdultPackages, configPolicy]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/integrations/int_google-calendar/configure", body: { ...adult, secretRef: "sk-live-abc123" } },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it("connects an OAuth integration via begin -> callback; secretRef becomes an account reference, never a token (RFC-017)", async () => {
    const oauthPolicy: Policy = {
      id: "pol_oauth",
      sphereId: "sph_1",
      description: "Adults may begin OAuth connects.",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["integration.oauth.begin"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    };
    const base = await pkgDeps([allowAdultPackages, oauthPolicy]);
    const pendingOAuth = new PendingOAuthStore(() => NOW);
    let n = 0;
    const deps: ApiDeps = { ...base, authBroker: new FakeAuthBroker(), pendingOAuth, newOAuthState: () => `n_${++n}`, oauthRedirectUri: "http://cb/oauth/connected" };
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);

    const begin = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/int_google-calendar/oauth/begin", body: adult }, deps);
    expect(begin.status).toBe(200);
    expect((begin.body as { authorizeUrl: string }).authorizeUrl).toContain("nonce=n_1");

    // Unknown nonce is refused (CSRF).
    expect((await handleApiRequest({ method: "GET", path: "/oauth/connected", query: { nonce: "forged" } }, deps)).status).toBe(403);

    const cb = await handleApiRequest({ method: "GET", path: "/oauth/connected", query: { nonce: "n_1" }, headers: { "x-fake-user": "alice" } }, deps);
    expect(cb.status).toBe(200);
    expect(cb.body).toMatchObject({ id: "int_google-calendar", provider: "google", connected: true });

    // The integration is now configured with a broker account reference — never a token.
    const list = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/integrations" }, deps);
    expect(JSON.stringify(list.body)).not.toContain("tok_"); // no token anywhere
    expect(JSON.stringify((deps.audit as InMemoryAuditSink).events)).not.toContain("tok_");
  });

  it("integration.oauth.begin is denied by default without a policy", async () => {
    const base = await pkgDeps([allowAdultPackages]);
    const deps: ApiDeps = { ...base, authBroker: new FakeAuthBroker(), pendingOAuth: new PendingOAuthStore(() => NOW), newOAuthState: () => "st", oauthRedirectUri: "http://cb" };
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);
    const begin = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/integrations/int_google-calendar/oauth/begin", body: adult }, deps);
    expect(begin.status).toBe(403);
  });

  it("integration.configure is denied by default without a policy", async () => {
    const deps = await pkgDeps([allowAdultPackages]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "google-calendar" } }, deps);
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/integrations/int_google-calendar/configure", body: { ...adult, provider: "caldav" } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  // RFC-011: the grant wizard — install creates the binding disabled and grants
  // nothing; enable activates it + applies the grant, so the agent's projected
  // surface (and thus the Sphere MCP tools/list) gains the capability.
  const allowProject: Policy = {
    id: "pol_proj",
    sphereId: "sph_1",
    description: "Parents may project agent runtime config.",
    subjectSelector: { roles: ["parent"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["runtime.config.project"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };

  async function pkgDepsWithAgent(policies: Policy[]) {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A", enabledCapabilities: ["calendar.read", "calendar.create_event"] });
    await store.save(exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    let n = 0;
    const deps: ApiDeps = { store, approvals: new InMemoryApprovalStore(), audit, auditSink: audit, newCorrelationId: () => `req_${++n}`, now: () => NOW };
    return deps;
  }

  const projectedTools = async (deps: ApiDeps): Promise<string[]> => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/agents/agt_0/runtime/projection", body: adult }, deps);
    return (res.body as { allowedTools?: string[] }).allowedTools ?? [];
  };

  it("install creates the binding disabled and grants nothing — projected surface stays empty", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    expect(await projectedTools(deps)).toEqual([]);
  });

  it("enable activates the binding + grant, so the agent's projected surface gains calendar.read", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/enable", body: adult }, deps);
    expect(await projectedTools(deps)).toContain("calendar.read");
  });

  it("disable empties the surface again (disabled binding → deny by default)", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/enable", body: adult }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/disable", body: adult }, deps);
    expect(await projectedTools(deps)).toEqual([]);
  });

  it("enable with an admin grant scopes calendar.read to teens (RFC-014), replacing the default", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    await handleApiRequest(
      {
        method: "POST",
        path: "/spheres/sph_1/packages/family-calendar/enable",
        body: { ...adult, grant: [{ ageProfiles: ["teen"], capabilities: ["calendar.read"] }] },
      },
      deps,
    );
    const pols = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/policies" }, deps);
    const ids = (pols.body as { policies: { id: string }[] }).policies.map((p) => p.id);
    // The custom clause is written; the adult default is NOT.
    expect(ids).toContain("pol_sph_1_pkg_family-calendar_grant_0");
    expect(ids).not.toContain("pol_sph_1_pkg_family-calendar_0");
  });

  it("rejects an enable grant naming a capability the package does not provide (400)", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    const res = await handleApiRequest(
      {
        method: "POST",
        path: "/spheres/sph_1/packages/family-calendar/enable",
        body: { ...adult, grant: [{ roles: ["parent"], capabilities: ["payment.execute"] }] },
      },
      deps,
    );
    expect(res.status).toBe(400);
  });

  it("re-enabling is idempotent (no duplicate grant policies)", async () => {
    const deps = await pkgDepsWithAgent([allowAdultPackages, allowProject]);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/install", body: { ...adult, packageId: "family-calendar" } }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/enable", body: adult }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/disable", body: adult }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/packages/family-calendar/enable", body: adult }, deps);
    const pols = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/policies" }, deps);
    const ids = (pols.body as { policies: { id: string }[] }).policies.map((p) => p.id);
    expect(ids.filter((id) => id === "pol_sph_1_pkg_family-calendar_0")).toHaveLength(1);
  });
});

describe("API router — runtime config projection preview (RFC-007/ADR-007)", () => {
  const searchBinding: CapabilityBinding = {
    capability: "memory.search",
    runtime: "hermes",
    runtimeToolName: "mem.search",
    execution: "local",
    risk: "low",
    requiresApproval: false,
    status: "enabled",
  };
  const allowSearchForParents: Policy = {
    id: "pol_search",
    sphereId: "sph_1",
    description: "Parents may search memory.",
    subjectSelector: { roles: ["parent"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["memory.search"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };
  const allowProjectForParents: Policy = {
    id: "pol_project",
    sphereId: "sph_1",
    description: "Parents may project agent runtime config.",
    subjectSelector: { roles: ["parent"] },
    action: "execute",
    resourceSelector: { capabilityNames: ["runtime.config.project"] },
    effect: "allow",
    priority: 0,
    version: 1,
    status: "active",
  };

  async function projDeps(): Promise<ApiDeps> {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A", enabledCapabilities: ["memory.search"] });
    await store.save(
      exportSphere({
        sphere,
        identities: [],
        agents: [agent],
        memory: [],
        policies: [allowSearchForParents, allowProjectForParents],
        bindings: [searchBinding],
        exportedAt: NOW,
      }),
    );
    let n = 0;
    return { store, approvals: new InMemoryApprovalStore(), audit: new InMemoryAuditSink(), newCorrelationId: () => `req_${++n}` };
  }

  const adult = { subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" } };

  it("returns the agent's governed projection: one Sphere MCP + authorized tool surface", async () => {
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/agents/agt_0/runtime/projection", body: adult },
      await projDeps(),
    );
    expect(res.status).toBe(200);
    const b = res.body as { allowedTools: string[]; gatewayEndpoint: string; authSecretRef: string; autonomousInstallDisabled: boolean };
    expect(b.allowedTools).toEqual(["memory.search"]);
    expect(b.gatewayEndpoint).toBe("mcp+http://spheres/sph_1/mcp");
    expect(b.authSecretRef).toBe("secret://sphere-mcp/sph_1/agt_0");
    expect(b.autonomousInstallDisabled).toBe(true);
  });

  it("backfills the default admin runtime-governance seed for projection preview when missing from the snapshot", async () => {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A" });
    await store.save(
      exportSphere({
        sphere,
        identities: [],
        agents: [agent],
        memory: [],
        policies: [allowSearchForParents, adminProvisioningSeed("sph_1")],
        bindings: [searchBinding],
        exportedAt: NOW,
      }),
    );
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/agents/agt_0/runtime/projection", body: adult },
      { store, approvals: new InMemoryApprovalStore(), audit: new InMemoryAuditSink(), newCorrelationId: () => "req_seed" },
    );
    expect(res.status).toBe(200);
  });

  it("denies a minor caller (deny by default)", async () => {
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/agents/agt_0/runtime/projection", body: { subject: { role: "child", ageProfile: "child" } } },
      await projDeps(),
    );
    expect(res.status).toBe(403);
  });

  it("404s for an unknown agent", async () => {
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/agents/ghost/runtime/projection", body: adult },
      await projDeps(),
    );
    expect(res.status).toBe(404);
  });
});

// --- Governed per-agent default model (RFC-009) ---

describe("API router — set an agent's default model", () => {
  const adminSubject = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
  const modelPath = "/spheres/sph_1/agents/agt_1/model";

  // Captures the model the runtime is actually asked to run (chat-path check).
  async function modelDeps(): Promise<{ deps: ApiDeps; lastModel: () => string | undefined }> {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({
      id: "agt_1",
      ownerId: "mbr_p1",
      ownerType: "member",
      sphereId: "sph_1",
      name: "Dad's agent",
    });
    await store.save(
      exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies: defaultAdminPolicies("sph_1"), exportedAt: NOW }),
    );
    let seen: string | undefined;
    let n = 0;
    let s = 0;
    const deps: ApiDeps = {
      store,
      approvals: new InMemoryApprovalStore(),
      audit: new InMemoryAuditSink(),
      auditSink: new InMemoryAuditSink(),
      sessions: new InMemorySessionStore(),
      runtime: {
        async listModels() {
          return ["test-model"];
        },
        async generate(request) {
          seen = request.model;
          return { model: request.model, content: "hi" };
        },
        async isAvailable() {
          return true;
        },
      },
      newCorrelationId: () => `req_${++n}`,
      newSessionId: () => `ses_${++s}`,
      now: () => NOW,
    };
    return { deps, lastModel: () => seen };
  }

  it("lets an administrator (founder/owner) set an agent's model, persisted", async () => {
    const { deps } = await modelDeps();
    const res = await handleApiRequest({ method: "POST", path: modelPath, body: { subject: adminSubject, model: "qwen2.5:7b" } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "executed", agentId: "agt_1", model: "qwen2.5:7b" });
    const snap = (await deps.store.load("sph_1"))!;
    expect(snap.agents[0]?.modelPreference).toBe("qwen2.5:7b");
  });

  it("the chat turn then runs on the agent's chosen model (RFC-009)", async () => {
    const { deps, lastModel } = await modelDeps();
    await handleApiRequest({ method: "POST", path: modelPath, body: { subject: adminSubject, model: "qwen2.5:7b" } }, deps);
    await handleApiRequest({ method: "POST", path: "/spheres/sph_1/sessions", body: { subject: adminSubject, agentId: "agt_1" } }, deps);
    const turn = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/sessions/ses_1/messages", body: { subject: adminSubject, text: "hi" } },
      deps,
    );
    expect(turn.status).toBe(200);
    expect(lastModel()).toBe("qwen2.5:7b"); // not the Sphere default llama3.2
  });

  it("denies a non-admin subject (403, deny by default)", async () => {
    const { deps } = await modelDeps();
    const res = await handleApiRequest(
      { method: "POST", path: modelPath, body: { subject: { memberId: "mbr_g1", role: "guest", ageProfile: "adult" }, model: "qwen2.5:7b" } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("denies a minor by the catalog floor even with a permissive role (403)", async () => {
    const { deps } = await modelDeps();
    const res = await handleApiRequest(
      { method: "POST", path: modelPath, body: { subject: { memberId: "mbr_c1", role: "parent", ageProfile: "child" }, model: "qwen2.5:7b" } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("404s for a missing agent", async () => {
    const { deps } = await modelDeps();
    const res = await handleApiRequest({ method: "POST", path: "/spheres/sph_1/agents/ghost/model", body: { subject: adminSubject, model: "x" } }, deps);
    expect(res.status).toBe(404);
  });

  it("rejects an empty model (400)", async () => {
    const { deps } = await modelDeps();
    const res = await handleApiRequest({ method: "POST", path: modelPath, body: { subject: adminSubject, model: "  " } }, deps);
    expect(res.status).toBe(400);
  });
});

// --- Harness terminal attach (ADR-008 §6) ------------------------------------

describe("API router — Harness terminal attach (ADR-008 §6)", () => {
  const tuiPath = "/spheres/sph_1/agents/agt_0/runtime/tui";
  const adminSubject = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };

  async function tuiDeps(policies: Policy[] = [adminProvisioningSeed("sph_1")]): Promise<
    ApiDeps & { tickets: TuiTicketStore; audit: InMemoryAuditSink }
  > {
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A" });
    await store.save(exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies, exportedAt: NOW }));
    const audit = new InMemoryAuditSink();
    const tickets = new TuiTicketStore(() => NOW);
    let n = 0;
    let t = 0;
    return {
      store,
      approvals: new InMemoryApprovalStore(),
      audit,
      auditSink: audit,
      tuiTickets: tickets,
      newTuiTicket: () => `tkt_${++t}`,
      newCorrelationId: () => `req_${++n}`,
      now: () => NOW,
      tickets,
    };
  }

  it("mints a single-use ticket for an administrator", async () => {
    const deps = await tuiDeps();
    const res = await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "executed", ticket: "tkt_1", agentId: "agt_0" });
  });

  it("denies a Sphere with no admin seed by default (no policy allows attach)", async () => {
    const deps = await tuiDeps([]);
    const res = await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, deps);
    expect(res.status).toBe(403);
  });

  it("denies a minor by the catalog profile floor, before any policy", async () => {
    const deps = await tuiDeps();
    const res = await handleApiRequest(
      { method: "POST", path: tuiPath, body: { subject: { memberId: "mbr_t1", role: "teenager", ageProfile: "teen" } } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("denies a non-administrator (guest) by default", async () => {
    const deps = await tuiDeps();
    const res = await handleApiRequest(
      { method: "POST", path: tuiPath, body: { subject: { memberId: "mbr_g1", role: "guest", ageProfile: "adult" } } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("404s for an unknown agent rather than minting a ticket", async () => {
    const deps = await tuiDeps();
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres/sph_1/agents/agt_nope/runtime/tui", body: { subject: adminSubject } },
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("audits that an attach was authorized, and never the ticket value", async () => {
    const deps = await tuiDeps();
    await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, deps);
    const { events } = deps.audit;
    const attach = events.find((e) => e.resourceId === "runtime.session.attach");
    expect(attach).toMatchObject({ decision: "executed" });
    expect(JSON.stringify(events)).not.toContain("tkt_1");
  });

  it("redeems a ticket once, returning the agent id and never a path", async () => {
    const deps = await tuiDeps();
    await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, deps);
    const res = await handleApiRequest({ method: "POST", path: "/tui/redeem", body: { ticket: "tkt_1" } }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agentId: "agt_0", sphereId: "sph_1" });
    expect(JSON.stringify(res.body)).not.toContain("/");
  });

  it("refuses a replayed ticket (single use)", async () => {
    const deps = await tuiDeps();
    await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, deps);
    await handleApiRequest({ method: "POST", path: "/tui/redeem", body: { ticket: "tkt_1" } }, deps);
    const replay = await handleApiRequest({ method: "POST", path: "/tui/redeem", body: { ticket: "tkt_1" } }, deps);
    expect(replay.status).toBe(403);
  });

  it("refuses a ticket that was never issued", async () => {
    const deps = await tuiDeps();
    const res = await handleApiRequest({ method: "POST", path: "/tui/redeem", body: { ticket: "tkt_forged" } }, deps);
    expect(res.status).toBe(403);
  });

  it("is disabled (501) when no ticket store is wired — deny by default", async () => {
    const deps = await tuiDeps();
    const { tuiTickets: _omitted, ...withoutTickets } = deps;
    const res = await handleApiRequest({ method: "POST", path: tuiPath, body: { subject: adminSubject } }, withoutTickets);
    expect(res.status).toBe(501);
  });
});
