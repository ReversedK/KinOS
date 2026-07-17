import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySphereStore,
  PROVISIONING_TOOLS,
  importSphere,
  type SphereStore,
} from "@kinos/core";
import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";

import { handleApiRequest, type ApiDeps } from "./router.js";
import {
  createAgentProvision,
  createSphereProvision,
  exportSphereProvision,
  inviteMemberProvision,
  managePolicyProvision,
  updateAgentProvision,
  type ProvisioningDeps,
} from "./provisioning.js";

const NOW = "2026-07-13T10:00:00.000Z";

function provDeps(store: SphereStore, audit?: InMemoryAuditSink): ProvisioningDeps {
  let n = 0;
  return {
    store,
    ...(audit !== undefined ? { auditSink: audit } : {}),
    now: () => NOW,
    newSphereId: () => `sph_${++n}`,
    newMemberId: () => `mbr_${++n}`,
    newIdentityId: () => `idy_${++n}`,
    newAgentId: () => `agt_${++n}`,
  };
}

describe("provisioning side effects (RFC-008)", () => {
  it("createSphereProvision creates a Sphere, founder-as-admin, and seeds the admin policy set", async () => {
    const store = new InMemorySphereStore();
    const audit = new InMemoryAuditSink();
    const res = await createSphereProvision(provDeps(store, audit), {
      sphereId: "sph_doe",
      name: "Doe Family",
      founderName: "Alex Doe",
      correlationId: "cor_1",
    });
    expect(res.sphereId).toBe("sph_doe");
    const snap = importSphere((await store.load("sph_doe"))!);
    expect(snap.sphere.name).toBe("Doe Family");
    expect(snap.sphere.administrators).toEqual([res.founderMemberId]);
    // Admin seed present so administrators can provision within the Sphere.
    expect(snap.policies.some((p) => p.id === "pol_sph_doe_admin_provisioning")).toBe(true);
    // RFC-007: administrators may govern Hermes runtime projection/state.
    const runtimePolicy = snap.policies.find((p) => p.id === "pol_sph_doe_admin_runtime_governance");
    expect(runtimePolicy?.effect).toBe("allow");
    expect(runtimePolicy?.resourceSelector.capabilityNames).toEqual([
      "runtime.config.project",
      "runtime.session.backup",
      "runtime.session.restore",
      // ADR-008 §6: attach a terminal to an agent's governed Harness profile.
      "runtime.session.attach",
    ]);
    // RFC-009: administrators (founder/owner) may set an agent's default model.
    const modelPolicy = snap.policies.find((p) => p.id === "pol_sph_doe_admin_model");
    expect(modelPolicy?.effect).toBe("allow");
    expect(modelPolicy?.resourceSelector.capabilityNames).toEqual(["model.set"]);
    // RFC-004/002: administrators may manage provider/model, connectors, packages.
    const settingsPolicy = snap.policies.find((p) => p.id === "pol_sph_doe_admin_settings");
    expect(settingsPolicy?.effect).toBe("allow");
    expect(settingsPolicy?.resourceSelector.capabilityNames).toContain("runtime.set_provider");
    expect(audit.byCorrelation("cor_1").map((e) => e.type)).toContain("sphere.created");
  });

  it("createSphereProvision refuses to overwrite an existing Sphere", async () => {
    const store = new InMemorySphereStore();
    const deps = provDeps(store);
    await createSphereProvision(deps, { sphereId: "sph_x", name: "X" });
    await expect(createSphereProvision(deps, { sphereId: "sph_x", name: "X2" })).rejects.toThrow(/already exists/);
  });

  it("inviteMemberProvision adds a member + identity", async () => {
    const store = new InMemorySphereStore();
    const deps = provDeps(store);
    await createSphereProvision(deps, { sphereId: "sph_1", name: "Fam" });
    const res = await inviteMemberProvision(deps, { sphereId: "sph_1", role: "child", displayName: "Kid" });
    const snap = importSphere((await store.load("sph_1"))!);
    expect(snap.sphere.members.some((m) => m.id === res.memberId && m.role === "child")).toBe(true);
    expect(snap.identities.some((i) => i.id === res.identityId && i.displayName === "Kid")).toBe(true);
  });

  it("createAgentProvision deploys an agent for a member with a capability scope", async () => {
    const store = new InMemorySphereStore();
    const deps = provDeps(store);
    const s = await createSphereProvision(deps, { sphereId: "sph_1", name: "Fam" });
    const res = await createAgentProvision(deps, {
      sphereId: "sph_1",
      ownerId: s.founderMemberId,
      name: "Admin agent",
      capabilities: ["memory.search", "calendar.create_event"],
    });
    const snap = importSphere((await store.load("sph_1"))!);
    const agent = snap.agents.find((a) => a.id === res.agentId);
    expect(agent?.enabledCapabilities).toEqual(["memory.search", "calendar.create_event"]);
    expect(agent?.state).toBe("configured");
  });

  it("createAgentProvision refuses to deploy for a non-member (deny by default)", async () => {
    const store = new InMemorySphereStore();
    const deps = provDeps(store);
    await createSphereProvision(deps, { sphereId: "sph_1", name: "Fam" });
    await expect(
      createAgentProvision(deps, { sphereId: "sph_1", ownerId: "mbr_ghost", name: "X" }),
    ).rejects.toThrow(/not a member/);
  });

  it("updateAgentProvision replaces the scope and activates the agent", async () => {
    const store = new InMemorySphereStore();
    const deps = provDeps(store);
    const s = await createSphereProvision(deps, { sphereId: "sph_1", name: "Fam" });
    const a = await createAgentProvision(deps, { sphereId: "sph_1", ownerId: s.founderMemberId, name: "A" });
    const res = await updateAgentProvision(deps, {
      sphereId: "sph_1",
      agentId: a.agentId,
      capabilities: ["memory.search"],
      state: "active",
    });
    expect(res.enabledCapabilities).toEqual(["memory.search"]);
    expect(res.state).toBe("active");
  });
});

// --- Full governed pipeline through the router --------------------------------

function apiDeps(store: SphereStore): ApiDeps & { audit: InMemoryAuditSink } {
  const audit = new InMemoryAuditSink();
  const approvals = new InMemoryApprovalStore();
  const pd = provDeps(store, audit);
  const executor = new LocalCapabilityExecutor(
    new Map<string, CapabilityHandler>([
      [PROVISIONING_TOOLS["sphere.create"], async (input) => createSphereProvision(pd, input as never)],
      [PROVISIONING_TOOLS["member.invite"], async (input) => inviteMemberProvision(pd, input as never)],
      [PROVISIONING_TOOLS["agent.create"], async (input) => createAgentProvision(pd, input as never)],
      [PROVISIONING_TOOLS["agent.update_config"], async (input) => updateAgentProvision(pd, input as never)],
      [PROVISIONING_TOOLS["policy.manage"], async (input) => managePolicyProvision(pd, input as never)],
      [PROVISIONING_TOOLS["sphere.export"], async (input) => exportSphereProvision(pd, input as never)],
    ]),
  );
  let c = 0;
  let a = 0;
  return {
    store,
    approvals,
    audit,
    auditSink: audit,
    executor,
    newCorrelationId: () => `req_${++c}`,
    newApprovalId: () => `apr_${++a}`,
    now: () => NOW,
  };
}

const adult = { role: "parent", ageProfile: "adult" as const };
const child = { role: "child", ageProfile: "child" as const };

describe("governed provisioning pipeline (RFC-008)", () => {
  it("POST /spheres: an adult creates a Sphere (bootstrap) → executed with a new id", async () => {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Doe Family" } } },
      deps,
    );
    expect(res.status).toBe(200);
    const out = (res.body as { output?: { sphereId?: string } }).output;
    expect(out?.sphereId).toBeDefined();
    expect((await store.list()).length).toBe(1);
    expect(deps.audit.byCorrelation(res.correlationId).map((e) => e.type)).toContain("sphere.created");
  });

  it("POST /spheres: a non-adult is denied by default (403)", async () => {
    const deps = apiDeps(new InMemorySphereStore());
    const res = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: child, input: { name: "X" } } },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("with the admin seed, an administrator can invite a member and deploy an agent through the execute path", async () => {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    // Bootstrap the Sphere.
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Fam" } } },
      deps,
    );
    const sphereId = (created.body as { output: { sphereId: string } }).output.sphereId;

    // Invite a member (allowed by the seeded admin policy).
    const invite = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/member.invite/execute`,
        body: { subject: adult, input: { role: "child", displayName: "Kid" } },
      },
      deps,
    );
    expect(invite.status).toBe(200);

    // Deploy an agent for the founder member.
    const snap = importSphere((await store.load(sphereId))!);
    const founder = snap.sphere.administrators[0]!;
    const deploy = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/agent.create/execute`,
        body: { subject: adult, input: { ownerId: founder, name: "Admin agent", capabilities: ["memory.search"] } },
      },
      deps,
    );
    expect(deploy.status).toBe(200);
    const after = importSphere((await store.load(sphereId))!);
    expect(after.sphere.members.length).toBe(2);
    expect(after.agents.length).toBe(1);
  });

  it("a non-administrator is denied provisioning by default (child → member.invite)", async () => {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Fam" } } },
      deps,
    );
    const sphereId = (created.body as { output: { sphereId: string } }).output.sphereId;
    const res = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/member.invite/execute`,
        body: { subject: child, input: { role: "child", displayName: "Kid" } },
      },
      deps,
    );
    expect(res.status).toBe(403);
  });

  it("an authorized side effect that fails (deploy for a non-member) is a governed 422, not a crash/500", async () => {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Fam" } } },
      deps,
    );
    const sphereId = (created.body as { output: { sphereId: string } }).output.sphereId;
    const res = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/agent.create/execute`,
        body: { subject: adult, input: { ownerId: "mbr_ghost", name: "A" } },
      },
      deps,
    );
    expect(res.status).toBe(422);
    expect(res.code).toBe("execution_failed");
  });

  it("deploying an agent with a capability in scope does not authorize that capability", async () => {
    // The agent's scope is a request surface; a subsequent capability call is
    // still governed. Here payment.execute has no policy/binding → denied.
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Fam" } } },
      deps,
    );
    const sphereId = (created.body as { output: { sphereId: string } }).output.sphereId;
    const snap = importSphere((await store.load(sphereId))!);
    const founder = snap.sphere.administrators[0]!;
    await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/agent.create/execute`,
        body: { subject: adult, input: { ownerId: founder, name: "A", capabilities: ["payment.execute"] } },
      },
      deps,
    );
    const pay = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/payment.execute/execute`,
        body: { subject: adult, input: {} },
      },
      deps,
    );
    expect(pay.status).toBe(403);
  });

  it("lets an administrator create a versioned permission rule through policy.manage", async () => {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Fam" } } },
      deps,
    );
    const sphereId = (created.body as { output: { sphereId: string } }).output.sphereId;
    const policy = {
      id: "pol_custom_calendar",
      sphereId,
      description: "Parents may create calendar events.",
      subjectSelector: { roles: ["parent"] },
      action: "execute" as const,
      resourceSelector: { capabilityNames: ["calendar.create_event"] },
      effect: "allow" as const,
      priority: 10,
      version: 1,
      status: "active" as const,
    };
    const managed = await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/policy.manage/execute`,
        body: { subject: adult, input: { policy } },
      },
      deps,
    );
    expect(managed.status).toBe(200);
    const read = await handleApiRequest({ method: "GET", path: `/spheres/${sphereId}/policies` }, deps);
    expect(read.status).toBe(200);
    expect((read.body as { policies: readonly { id: string }[] }).policies.some((item) => item.id === policy.id)).toBe(true);
  });
});

// --- sphere.export (RFC-021) --------------------------------------------------

describe("sphere.export — full-fidelity, admin-gated (RFC-021)", () => {
  async function bootstrapped(): Promise<{ deps: ReturnType<typeof apiDeps>; store: InMemorySphereStore; sphereId: string }> {
    const store = new InMemorySphereStore();
    const deps = apiDeps(store);
    const created = await handleApiRequest(
      { method: "POST", path: "/spheres", body: { subject: adult, input: { name: "Doe Family" } } },
      deps,
    );
    return { deps, store, sphereId: (created.body as { output: { sphereId: string } }).output.sphereId };
  }

  const exportPath = (sphereId: string) => `/spheres/${sphereId}/capabilities/sphere.export/execute`;

  it("an identified adult cannot export unilaterally — the approval floor suspends it", async () => {
    const { deps, store, sphereId } = await bootstrapped();
    const founder = importSphere((await store.load(sphereId))!).sphere.administrators[0]!;
    const res = await handleApiRequest(
      { method: "POST", path: exportPath(sphereId), body: { subject: { ...adult, memberId: founder } } },
      deps,
    );
    expect(res.status).toBe(202);
    expect(res.code).toBe("approval_required");
    // The snapshot must not be handed over with the pending response.
    expect(JSON.stringify(res.body)).not.toContain("kinos.sphere.export");
  });

  // Regression: an anonymous subject (no memberId, no agentId) made the core's
  // no-self-approval check silently unfirable, so one caller could raise an export
  // and then grant it themselves — walking away with every member's private
  // memory. An approval-gated action now requires an identified requester.
  it("refuses an approval-gated export from an anonymous subject (separation of duties)", async () => {
    const { deps, sphereId } = await bootstrapped();
    const res = await handleApiRequest({ method: "POST", path: exportPath(sphereId), body: { subject: adult } }, deps);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/identified requester/i);
    expect(JSON.stringify(res.body)).not.toContain("kinos.sphere.export");
  });

  it("a child is denied by the catalog profile floor (403)", async () => {
    const { deps, sphereId } = await bootstrapped();
    const res = await handleApiRequest({ method: "POST", path: exportPath(sphereId), body: { subject: child } }, deps);
    expect(res.status).toBe(403);
  });

  it("returns the full snapshot once a second adult grants, and it round-trips through importSphere", async () => {
    const { deps, store, sphereId } = await bootstrapped();
    // A second adult, so an approver other than the requester exists.
    await handleApiRequest(
      {
        method: "POST",
        path: `/spheres/${sphereId}/capabilities/member.invite/execute`,
        body: { subject: adult, input: { role: "parent", displayName: "Second Parent" } },
      },
      deps,
    );
    const snapBefore = importSphere((await store.load(sphereId))!);
    const approver = snapBefore.sphere.members.find((m) => m.role === "parent" && m.id !== snapBefore.sphere.administrators[0])!;

    const pending = await handleApiRequest(
      { method: "POST", path: exportPath(sphereId), body: { subject: { ...adult, memberId: snapBefore.sphere.administrators[0] } } },
      deps,
    );
    const approvalId = (pending.body as { approvalId: string }).approvalId;

    const granted = await handleApiRequest(
      { method: "POST", path: `/approvals/${approvalId}/grant`, body: { approver: { memberId: approver.id, role: "parent" } } },
      deps,
    );
    expect(granted.status).toBe(200);
    const output = (granted.body as { output?: unknown }).output;

    // Fidelity: the payload is a valid export snapshot that imports unchanged.
    const reimported = importSphere(output);
    expect(reimported.sphere.id).toBe(sphereId);
    expect(reimported.sphere.members.length).toBe(snapBefore.sphere.members.length);
    expect(reimported.policies.length).toBe(snapBefore.policies.length);
    expect((output as { format: string }).format).toBe("kinos.sphere.export");
  });

  it("the snapshot never enters the audit log (audit minimality)", async () => {
    const { deps, sphereId } = await bootstrapped();
    await handleApiRequest({ method: "POST", path: exportPath(sphereId), body: { subject: adult } }, deps);
    // Every recorded event is a security fact; none carries the export payload.
    const recorded = JSON.stringify(deps.audit.events);
    expect(recorded).not.toContain("kinos.sphere.export");
    // The governed pipeline still audits the attempt itself.
    expect(deps.audit.events.some((e) => e.resourceId === "sphere.export")).toBe(true);
  });
});
