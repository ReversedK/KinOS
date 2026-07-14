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
  inviteMemberProvision,
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
    // RFC-009: administrators (founder/owner) may set an agent's default model.
    const modelPolicy = snap.policies.find((p) => p.id === "pol_sph_doe_admin_model");
    expect(modelPolicy?.effect).toBe("allow");
    expect(modelPolicy?.resourceSelector.capabilityNames).toEqual(["model.set"]);
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
});
