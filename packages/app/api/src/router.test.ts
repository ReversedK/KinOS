import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySessionStore,
  InMemorySphereStore,
  createApprovalFromDecision,
  createIntegration,
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

  it("reports a sphere's resolved runtime profile (local-first default)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1/runtime" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      provider: "ollama",
      execution: "local",
      cloudInferenceEnabled: false,
      allowed: true,
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
      integrations: [{ id: "int_1", provider: "google", status: "proposed", scopes: ["calendar.read"], providesCapabilities: ["calendar.create_event"] }],
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
});
