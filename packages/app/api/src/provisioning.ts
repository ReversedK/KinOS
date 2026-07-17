/**
 * Provisioning side effects (RFC-008).
 *
 * The executor-side work behind the provisioning capabilities (`sphere.create`,
 * `member.invite`, `agent.create`, `agent.update_config`). Each runs ONLY after
 * the governed pipeline has authorized the call (policy double-check + any
 * approval floor) — these are binding targets, not authorization points
 * (invariants 3, 6). They mutate the canonical SphereStore and record a minimal
 * audit fact (ids/role/decision, never private content) under the call's
 * correlation id.
 *
 * Ids are generated here (the application layer), keeping the domain core
 * deterministic and free of any crypto/random dependency.
 */

import {
  activateAgent,
  addMember,
  createAgent,
  createIdentity,
  createSphere,
  defaultAdminPolicies,
  disableAgent,
  exportSphere,
  importSphere,
  pauseAgent,
  type AuditSink,
  type KinEventType,
  type Policy,
  type Role,
  type SphereExport,
  type SphereStore,
  type SphereType,
} from "@kinos/core";

export interface ProvisioningDeps {
  readonly store: SphereStore;
  readonly auditSink?: AuditSink;
  readonly now?: () => string;
  readonly newSphereId: () => string;
  readonly newMemberId: () => string;
  readonly newIdentityId: () => string;
  readonly newAgentId: () => string;
}

const nowOf = (deps: ProvisioningDeps): string => (deps.now ?? (() => new Date().toISOString()))();

function audit(
  deps: ProvisioningDeps,
  type: KinEventType,
  sphereId: string,
  resourceId: string,
  correlationId: string | undefined,
  at: string,
): void {
  if (deps.auditSink === undefined || correlationId === undefined) return;
  deps.auditSink.record({
    type,
    sphereId,
    resourceType: type.startsWith("sphere") ? "sphere" : "capability",
    resourceId,
    correlationId,
    createdAt: at,
  });
}

/** Re-export a loaded snapshot, replacing only the sections the caller changed. */
function reexport(
  imported: ReturnType<typeof importSphere>,
  changes: Partial<Pick<SphereExport, "sphere" | "identities" | "agents" | "policies">>,
  exportedAt: string,
): SphereExport {
  return exportSphere({
    sphere: changes.sphere ?? imported.sphere,
    identities: changes.identities ?? imported.identities,
    agents: changes.agents ?? imported.agents,
    memory: imported.memory,
    policies: changes.policies ?? imported.policies,
    bindings: imported.bindings,
    runtimeConfig: imported.runtimeConfig,
    integrations: imported.integrations,
    packages: imported.packages,
    exportedAt,
  });
}

async function loadOrThrow(deps: ProvisioningDeps, sphereId: string): Promise<SphereExport> {
  const snap = await deps.store.load(sphereId);
  if (snap === undefined) throw new Error(`Sphere ${sphereId} not found`);
  return snap;
}

// --- sphere.create (bootstrap) ---------------------------------------------

export interface CreateSphereInput {
  /** Router-generated Sphere id (so the whole action chains under it). */
  readonly sphereId?: string;
  readonly name?: string;
  readonly type?: SphereType;
  readonly founderName?: string;
  readonly founderRole?: Role;
  readonly correlationId?: string;
}

export interface CreateSphereResult {
  readonly sphereId: string;
  readonly founderMemberId: string;
  readonly type: SphereType;
  readonly name: string;
}

/**
 * `sphere.create` side effect: create a Sphere (founder = first administrator),
 * seed the default admin policy set so administrators can provision within it
 * (RFC-008), persist, and audit `sphere.created`.
 */
export async function createSphereProvision(
  deps: ProvisioningDeps,
  input: CreateSphereInput,
): Promise<CreateSphereResult> {
  const sphereId = input.sphereId ?? deps.newSphereId();
  if ((await deps.store.load(sphereId)) !== undefined) {
    throw new Error(`Sphere ${sphereId} already exists`);
  }
  const name = (input.name ?? "").trim();
  if (name.length === 0) throw new Error("Sphere name must not be empty");
  const type: SphereType = input.type ?? "family";
  const founderRole: Role = input.founderRole ?? "parent";
  const memberId = deps.newMemberId();
  const identityId = deps.newIdentityId();

  const sphere = createSphere({
    id: sphereId,
    type,
    name,
    founder: { memberId, identityId, role: founderRole },
  });
  const founder = createIdentity({ id: identityId, displayName: (input.founderName ?? name).trim() });
  const at = nowOf(deps);
  const snapshot = exportSphere({
    sphere,
    identities: [founder],
    agents: [],
    memory: [],
    policies: defaultAdminPolicies(sphereId),
    exportedAt: at,
  });
  await deps.store.save(snapshot);
  audit(deps, "sphere.created", sphereId, sphereId, input.correlationId, at);
  return { sphereId, founderMemberId: memberId, type, name };
}

// --- member.invite ----------------------------------------------------------

export interface InviteMemberInput {
  readonly sphereId?: string;
  readonly role?: Role;
  readonly displayName?: string;
  readonly correlationId?: string;
}

export interface InviteMemberResult {
  readonly memberId: string;
  readonly identityId: string;
  readonly role: Role;
}

/** `member.invite` side effect: add a member (role + identity) to the Sphere. */
export async function inviteMemberProvision(
  deps: ProvisioningDeps,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  if (input.sphereId === undefined) throw new Error("sphereId is required");
  if (input.role === undefined) throw new Error("A member role is required");
  const displayName = (input.displayName ?? "").trim();
  if (displayName.length === 0) throw new Error("A member displayName is required");

  const imported = importSphere(await loadOrThrow(deps, input.sphereId));
  const memberId = deps.newMemberId();
  const identityId = deps.newIdentityId();
  const sphere = addMember(imported.sphere, { memberId, identityId, role: input.role });
  const identity = createIdentity({ id: identityId, displayName });
  const at = nowOf(deps);
  await deps.store.save(
    reexport(imported, { sphere, identities: [...imported.identities, identity] }, at),
  );
  audit(deps, "member.invited", input.sphereId, memberId, input.correlationId, at);
  return { memberId, identityId, role: input.role };
}

// --- agent.create -----------------------------------------------------------

export interface CreateAgentInput {
  readonly sphereId?: string;
  readonly ownerId?: string;
  readonly name?: string;
  readonly capabilities?: readonly string[];
  readonly model?: string;
  readonly correlationId?: string;
}

export interface CreateAgentResult {
  readonly agentId: string;
  readonly ownerId: string;
  readonly enabledCapabilities: readonly string[];
}

/**
 * `agent.create` side effect: deploy an agent for a member of the Sphere with a
 * capability scope. The scope is a request surface only — every capability the
 * agent later requests is still policy-checked per call (RFC-008).
 */
export async function createAgentProvision(
  deps: ProvisioningDeps,
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  if (input.sphereId === undefined) throw new Error("sphereId is required");
  if (input.ownerId === undefined) throw new Error("An agent ownerId (member) is required");
  const name = (input.name ?? "").trim();
  if (name.length === 0) throw new Error("An agent name is required");

  const imported = importSphere(await loadOrThrow(deps, input.sphereId));
  // Deny by default: an agent can only be deployed for an existing member.
  if (!imported.sphere.members.some((m) => m.id === input.ownerId)) {
    throw new Error(`Member ${input.ownerId} is not a member of Sphere ${input.sphereId}`);
  }
  const agentId = deps.newAgentId();
  const agent = createAgent({
    id: agentId,
    ownerId: input.ownerId,
    ownerType: "member",
    sphereId: input.sphereId,
    name,
    ...(input.model !== undefined ? { modelPreference: input.model } : {}),
    ...(input.capabilities !== undefined ? { enabledCapabilities: input.capabilities } : {}),
  });
  const at = nowOf(deps);
  await deps.store.save(reexport(imported, { agents: [...imported.agents, agent] }, at));
  audit(deps, "agent.created", input.sphereId, agentId, input.correlationId, at);
  return { agentId, ownerId: input.ownerId, enabledCapabilities: agent.enabledCapabilities };
}

// --- agent.update_config ----------------------------------------------------

export interface UpdateAgentInput {
  readonly sphereId?: string;
  readonly agentId?: string;
  /** Full replacement of the capability scope, when provided. */
  readonly capabilities?: readonly string[];
  readonly model?: string;
  readonly state?: "active" | "paused" | "disabled";
  readonly correlationId?: string;
}

export interface UpdateAgentResult {
  readonly agentId: string;
  readonly enabledCapabilities: readonly string[];
  readonly state: string;
}

/**
 * `agent.update_config` side effect: change an agent's capability scope, model
 * tag or lifecycle state. Model swaps are "boring" — no new identity, no
 * memory/policy migration (coding principle 9).
 */
export async function updateAgentProvision(
  deps: ProvisioningDeps,
  input: UpdateAgentInput,
): Promise<UpdateAgentResult> {
  if (input.sphereId === undefined) throw new Error("sphereId is required");
  if (input.agentId === undefined) throw new Error("An agentId is required");

  const imported = importSphere(await loadOrThrow(deps, input.sphereId));
  const idx = imported.agents.findIndex((a) => a.id === input.agentId);
  if (idx === -1) throw new Error(`Agent ${input.agentId} not found in Sphere ${input.sphereId}`);

  let agent = imported.agents[idx]!;
  if (input.capabilities !== undefined) {
    agent = { ...agent, enabledCapabilities: [...input.capabilities] };
  }
  if (input.model !== undefined) {
    agent = { ...agent, modelPreference: input.model };
  }
  if (input.state === "active") agent = activateAgent(agent);
  else if (input.state === "paused") agent = pauseAgent(agent);
  else if (input.state === "disabled") agent = disableAgent(agent);

  const agents = [...imported.agents];
  agents[idx] = agent;
  const at = nowOf(deps);
  await deps.store.save(reexport(imported, { agents }, at));
  audit(deps, "agent.updated", input.sphereId, agent.id, input.correlationId, at);
  return { agentId: agent.id, enabledCapabilities: agent.enabledCapabilities, state: agent.state };
}

// --- policy.manage ---------------------------------------------------------

export interface ManagePolicyInput {
  readonly sphereId?: string;
  readonly policy?: Policy;
  readonly correlationId?: string;
}

export interface ManagePolicyResult {
  readonly policyId: string;
  readonly version: number;
  readonly status: Policy["status"];
}

/** Persist one complete, versioned policy after the governed admin check. */
export async function managePolicyProvision(
  deps: ProvisioningDeps,
  input: ManagePolicyInput,
): Promise<ManagePolicyResult> {
  if (input.sphereId === undefined) throw new Error("sphereId is required");
  if (input.policy === undefined) throw new Error("A policy is required");
  if (input.policy.sphereId !== input.sphereId) throw new Error("Policy Sphere does not match the request Sphere");
  if (input.policy.id.trim() === "" || input.policy.description.trim() === "") {
    throw new Error("Policy id and description are required");
  }
  if (input.policy.action !== "execute" && input.policy.action !== "any") {
    throw new Error("The admin UI currently manages execute policies only");
  }
  if ((input.policy.resourceSelector.capabilityNames?.length ?? 0) === 0) {
    throw new Error("A managed policy must target at least one capability");
  }
  if (input.policy.effect === "require_approval" && (input.policy.approverRoles?.length ?? 0) === 0) {
    throw new Error("An approval policy requires at least one approver role");
  }

  const imported = importSphere(await loadOrThrow(deps, input.sphereId));
  const previous = imported.policies.find((policy) => policy.id === input.policy?.id);
  if (previous !== undefined && input.policy.version <= previous.version) {
    throw new Error(`Policy ${input.policy.id} version must be greater than ${previous.version}`);
  }
  const policies = previous === undefined
    ? [...imported.policies, input.policy]
    : imported.policies.map((policy) => policy.id === input.policy?.id ? input.policy as Policy : policy);
  const at = nowOf(deps);
  await deps.store.save(reexport(imported, { policies }, at));
  const eventType: KinEventType = input.policy.status === "disabled"
    ? "policy.disabled"
    : previous === undefined ? "policy.created" : "policy.activated";
  audit(deps, eventType, input.sphereId, input.policy.id, input.correlationId, at);
  return { policyId: input.policy.id, version: input.policy.version, status: input.policy.status };
}

// --- sphere.export (RFC-021) -----------------------------------------------

export interface ExportSphereInput {
  readonly sphereId?: string;
  readonly correlationId?: string;
}

/**
 * Return the Sphere's complete snapshot for backup/restore (RFC-021,
 * results-contract §17/§19). Full fidelity by decision: it includes every
 * member's memory, private items included, because a snapshot that omits them
 * cannot restore the Sphere. Embeddings are excluded by the format (derived and
 * regenerable).
 *
 * This is a binding target, not an authorization point. It runs only after the
 * governed pipeline authorized `sphere.export` — adult-only by the catalog
 * profile floor, and always approval-floored, so the core's no-self-approval rule
 * prevents one administrator from unilaterally exporting a Sphere that holds
 * another member's private memory.
 *
 * The pipeline itself audits the call (`capability.requested/allowed/executed`
 * carry actor, capability, decision, policy and correlation id), so nothing is
 * recorded here — and the snapshot must never enter audit (audit minimality).
 *
 * A local backup only: returning the payload to the authorized caller is not an
 * external transfer, which stays a separate, stricter decision (RFC-021).
 */
export async function exportSphereProvision(
  deps: ProvisioningDeps,
  input: ExportSphereInput,
): Promise<SphereExport> {
  if (input.sphereId === undefined) throw new Error("sphereId is required");
  const imported = importSphere(await loadOrThrow(deps, input.sphereId));
  // Re-stamp exportedAt: this snapshot is being exported now, not at last write.
  return exportSphere({ ...imported, exportedAt: nowOf(deps) });
}
