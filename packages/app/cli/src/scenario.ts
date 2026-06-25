/**
 * MVP §19 acceptance scenario.
 *
 * Drives the whole results-contract §19 sequence as one flow, using only the
 * domain core and an injected AgentRuntime port (the CLI passes the Ollama
 * adapter; tests pass a fake). Each criterion is exercised with the real domain
 * code and recorded as a pass/fail with a short, content-free detail.
 *
 * This is an orchestrator, not new domain logic: it composes @kinos/core. No
 * provider specifics leak in — the runtime arrives through the port.
 */

import {
  authorizeMemoryRead,
  createAgent,
  createApprovalFromDecision,
  createIdentity,
  createMemoryItem,
  createSphere,
  addMember,
  evaluate,
  exportSphere,
  importSphere,
  isAuthorized,
  recordApprovalDecision,
  revokeShare,
  shareWithMembers,
  type AgentRuntime,
  type Policy,
  type PolicyRequest,
} from "@kinos/core";

export interface Criterion {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface MvpReport {
  readonly criteria: readonly Criterion[];
  readonly allPassed: boolean;
}

export interface ScenarioDeps {
  readonly runtime: AgentRuntime;
  readonly now: string;
}

function adult(memberId: string): PolicyRequest["subject"] {
  return { memberId, role: "parent", ageProfile: "adult" };
}
function child(memberId: string): PolicyRequest["subject"] {
  return { memberId, role: "child", ageProfile: "child" };
}

export async function runMvpScenario(deps: ScenarioDeps): Promise<MvpReport> {
  const { now } = deps;
  const criteria: Criterion[] = [];
  const add = (id: string, description: string, passed: boolean, detail: string) =>
    criteria.push({ id, description, passed, detail });

  const ctx = (correlationId: string) => ({ sphereId: "sph_1", time: now, correlationId });

  // 1. A Sphere can be created.
  let sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  add("sphere-created", "a Sphere can be created", sphere.status === "active", `status=${sphere.status}`);

  // 2. Two adults and one child can be added.
  sphere = addMember(sphere, { memberId: "mbr_p2", identityId: "idy_p2", role: "parent" });
  sphere = addMember(sphere, { memberId: "mbr_c1", identityId: "idy_c1", role: "child" });
  add(
    "members-added",
    "two adults and one child can be added",
    sphere.members.length === 3,
    `members=${sphere.members.length}`,
  );

  // 3. Each member can have an agent.
  const identities = [
    createIdentity({ id: "idy_p1", displayName: "Parent One" }),
    createIdentity({ id: "idy_p2", displayName: "Parent Two" }),
    createIdentity({ id: "idy_c1", displayName: "Child One" }),
  ];
  const agents = sphere.members.map((m, i) =>
    createAgent({
      id: `agt_${i}`,
      ownerId: m.id,
      ownerType: "member",
      sphereId: "sph_1",
      name: `${m.id} agent`,
    }),
  );
  add(
    "agent-per-member",
    "each member can have an agent",
    agents.length === sphere.members.length,
    `agents=${agents.length}`,
  );

  // 4. The child cannot access private adult memory.
  let note = createMemoryItem({
    id: "mem_1",
    ownerId: "mbr_p1",
    ownerType: "member",
    sphereId: "sph_1",
    content: "a private parent note",
    source: "manual",
    now,
  });
  const childDenied = authorizeMemoryRead(child("mbr_c1"), note, [], ctx("cor_read")).effect;
  const ownerAllowed = authorizeMemoryRead(adult("mbr_p1"), note, [], ctx("cor_read")).effect;
  add(
    "child-denied-private-memory",
    "the child cannot access private adult memory",
    childDenied === "deny" && ownerAllowed === "allow",
    `child=${childDenied}, owner=${ownerAllowed}`,
  );

  // 5. Memory can be shared and revoked.
  note = shareWithMembers(note, { subjectIds: ["mbr_c1"], grantedBy: "mbr_p1", now });
  const afterShare = authorizeMemoryRead(child("mbr_c1"), note, [], ctx("cor_share")).effect;
  note = revokeShare(note, { subjectId: "mbr_c1", now });
  const afterRevoke = authorizeMemoryRead(child("mbr_c1"), note, [], ctx("cor_revoke")).effect;
  add(
    "memory-share-revoke",
    "memory can be shared and revoked",
    afterShare === "allow" && afterRevoke === "deny",
    `afterShare=${afterShare}, afterRevoke=${afterRevoke}`,
  );

  // 6. A capability can be allowed for an adult and denied to a child.
  const policies: Policy[] = [
    {
      id: "pol_adult_calendar",
      sphereId: "sph_1",
      description: "Adults may create calendar events.",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["calendar.create_event"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
    {
      id: "pol_payment_approval",
      sphereId: "sph_1",
      description: "Payments require a parent's approval.",
      subjectSelector: {},
      action: "execute",
      resourceSelector: { capabilityNames: ["payment.execute"] },
      effect: "require_approval",
      approverRoles: ["parent"],
      priority: 10,
      version: 1,
      status: "active",
    },
  ];
  const calReq = (subject: PolicyRequest["subject"]): PolicyRequest => ({
    subject,
    action: "execute",
    resource: { type: "capability", capabilityName: "calendar.create_event" },
    context: { sphereId: "sph_1", time: now, execution: "local", correlationId: "cor_cal" },
  });
  const adultCap = evaluate(calReq(adult("mbr_p1")), policies).effect;
  const childCap = evaluate(calReq(child("mbr_c1")), policies).effect;
  add(
    "capability-adult-vs-child",
    "a capability can be allowed for an adult and denied to a child",
    adultCap === "allow" && childCap === "deny",
    `adult=${adultCap}, child=${childCap}`,
  );

  // 7. A sensitive action can trigger approval.
  const payDecision = evaluate(
    {
      subject: { ...adult("mbr_p1"), agentId: "agt_0" },
      action: "execute",
      resource: { type: "capability", capabilityName: "payment.execute", riskLevel: "critical" },
      context: { sphereId: "sph_1", time: now, execution: "local", correlationId: "cor_pay" },
    },
    policies,
  );
  let approvalOk = payDecision.effect === "require_approval";
  let approvalDetail = `decision=${payDecision.effect}`;
  if (payDecision.effect === "require_approval") {
    let approval = createApprovalFromDecision({
      id: "apr_1",
      sphereId: "sph_1",
      decision: payDecision,
      requestedBy: { agentId: "agt_0", onBehalfOf: "mbr_p1" },
      action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "Pay a bill" },
      createdAt: now,
    });
    const pendingBefore = approval.state === "pending";
    // a different parent approves (separation of duties)
    approval = recordApprovalDecision(approval, {
      approver: { memberId: "mbr_p2", roles: ["parent"], ageProfile: "adult" },
      decision: "grant",
      at: now,
    });
    approvalOk = pendingBefore && isAuthorized(approval);
    approvalDetail = `pendingBefore=${pendingBefore}, finalState=${approval.state}`;
  }
  add("sensitive-action-approval", "a sensitive action can trigger approval", approvalOk, approvalDetail);

  // 8. The system runs with a local model runtime.
  const available = await deps.runtime.isAvailable();
  const models = available ? await deps.runtime.listModels() : [];
  add(
    "local-model-runtime",
    "the system runs with a local model runtime",
    available,
    available ? `runtime reachable (models=${models.length})` : "runtime not reachable",
  );

  // 9. Data can be exported.
  const snapshot = exportSphere({ sphere, identities, agents, memory: [note], policies, exportedAt: now });
  const restored = importSphere(JSON.parse(JSON.stringify(snapshot)));
  const exportOk =
    restored.sphere.id === sphere.id && restored.memory.length === 1 && restored.policies.length === 2;
  add("data-export", "data can be exported", exportOk, `restoredSphere=${restored.sphere.id}`);

  return { criteria, allPassed: criteria.every((c) => c.passed) };
}
