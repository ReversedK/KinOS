/**
 * CLI commands over a SphereStore.
 *
 * Command logic is provider-free: it takes an injected SphereStore (the CLI
 * wires SQLite; tests wire in-memory) and the domain core. This proves
 * results-contract §1 ("the database is initialized") and §15 (local-first
 * durability): a Sphere created here is persisted and read back later.
 */

import {
  beginSensitiveAction,
  createIdentity,
  createSphere,
  defaultCapabilityCatalog,
  exportSphere,
  importSphere,
  resolveApproval,
  type ApprovalStore,
  type AuditReader,
  type AuditSink,
  type CapabilityExecutionRequest,
  type CapabilityExecutor,
  type PolicyRequest,
  type SphereStore,
} from "@kinos/core";

export interface InitSphereArgs {
  readonly id: string;
  readonly name: string;
  readonly founderName: string;
  readonly now: string;
  /** When provided, a sphere.created audit event is recorded. */
  readonly audit?: AuditSink;
  readonly correlationId?: string;
}

/** Create a family Sphere with a founding parent and persist it. */
export async function initSphere(store: SphereStore, args: InitSphereArgs): Promise<string> {
  if ((await store.load(args.id)) !== undefined) {
    throw new Error(`Sphere ${args.id} already exists`);
  }
  const founderIdentityId = `idy_${args.id}_founder`;
  const sphere = createSphere({
    id: args.id,
    type: "family",
    name: args.name,
    founder: { memberId: `mbr_${args.id}_founder`, identityId: founderIdentityId, role: "parent" },
  });
  const founder = createIdentity({ id: founderIdentityId, displayName: args.founderName });
  const snapshot = exportSphere({
    sphere,
    identities: [founder],
    agents: [],
    memory: [],
    policies: [],
    exportedAt: args.now,
  });
  await store.save(snapshot);

  if (args.audit !== undefined && args.correlationId !== undefined) {
    args.audit.record({
      type: "sphere.created",
      sphereId: args.id,
      resourceType: "sphere",
      resourceId: args.id,
      correlationId: args.correlationId,
      createdAt: args.now,
    });
  }
  return `Initialized Sphere ${args.id} ("${args.name}").`;
}

export async function listSpheres(store: SphereStore): Promise<string> {
  const ids = await store.list();
  return ids.length === 0 ? "(no Spheres)" : ids.join("\n");
}

export async function showSphere(store: SphereStore, id: string): Promise<string> {
  const snap = await store.load(id);
  if (snap === undefined) return `Sphere ${id} not found.`;
  return [
    `id: ${snap.sphere.id}`,
    `name: ${snap.sphere.name}`,
    `type: ${snap.sphere.type}`,
    `status: ${snap.sphere.status}`,
    `members: ${snap.sphere.members.length}`,
    `identities: ${snap.identities.length}`,
  ].join("\n");
}

export interface RunCapabilityDeps {
  readonly store: SphereStore;
  readonly executor: CapabilityExecutor;
  readonly audit: AuditSink;
  readonly newApprovalId: () => string;
  /** When provided, a pending approval is persisted for a later `approve`. */
  readonly approvals?: ApprovalStore;
}

export interface RunCapabilityArgs {
  readonly sphereId: string;
  readonly capabilityName: string;
  readonly profile: "adult" | "child";
  readonly now: string;
  readonly correlationId: string;
}

function demoSubject(sphereId: string, profile: "adult" | "child"): PolicyRequest["subject"] {
  return profile === "adult"
    ? {
        memberId: `mbr_${sphereId}_founder`,
        agentId: `agt_${sphereId}_admin`,
        role: "parent",
        ageProfile: "adult",
      }
    : {
        memberId: `mbr_${sphereId}_child`,
        agentId: `agt_${sphereId}_child`,
        role: "child",
        ageProfile: "child",
      };
}

/**
 * Drive the governed execute loop for a persisted Sphere: load its policies and
 * bindings, run beginSensitiveAction through the injected executor and audit
 * sink, and summarize the outcome (executed / denied / pending approval).
 */
export async function runCapability(
  deps: RunCapabilityDeps,
  args: RunCapabilityArgs,
): Promise<string> {
  const snap = await deps.store.load(args.sphereId);
  if (snap === undefined) return `Sphere ${args.sphereId} not found.`;
  const imported = importSphere(snap);

  const request: CapabilityExecutionRequest = {
    subject: demoSubject(args.sphereId, args.profile),
    capabilityName: args.capabilityName,
    input: {},
    context: {
      sphereId: args.sphereId,
      time: args.now,
      execution: "local",
      correlationId: args.correlationId,
    },
  };

  const result = await beginSensitiveAction(request, {
    catalog: defaultCapabilityCatalog(),
    bindings: imported.bindings,
    policies: imported.policies,
    executor: deps.executor,
    audit: deps.audit,
    newApprovalId: deps.newApprovalId,
  });

  if (result.status === "pending_approval" && result.approval !== undefined && deps.approvals !== undefined) {
    await deps.approvals.save({ approval: result.approval, request });
  }

  const lines = [
    `capability: ${args.capabilityName}`,
    `actor: ${args.profile}`,
    `outcome: ${result.status}`,
    `reason: ${result.reason}`,
  ];
  if (result.approval !== undefined) {
    lines.push(
      `approvalId: ${result.approval.id} (state ${result.approval.state}, approvers ${result.approval.approverRoles.join(", ")})`,
    );
  }
  lines.push(`correlationId: ${args.correlationId}`);
  return lines.join("\n");
}

export interface ApproveDeps {
  readonly store: SphereStore;
  readonly approvals: ApprovalStore;
  readonly executor: CapabilityExecutor;
  readonly audit: AuditSink;
}

export interface ApproveArgs {
  readonly approvalId: string;
  readonly decision: "grant" | "deny";
  readonly approverMemberId: string;
  readonly approverRole: string;
  readonly now: string;
}

/**
 * Resolve a persisted pending approval: record the human decision (audited) and,
 * on a quorum of grants, resume the one authorized execution via the Sphere's
 * bindings and the injected executor. Updates the stored approval state.
 */
export async function approveCapability(deps: ApproveDeps, args: ApproveArgs): Promise<string> {
  const pending = await deps.approvals.load(args.approvalId);
  if (pending === undefined) return `Approval ${args.approvalId} not found.`;
  if (pending.approval.state !== "pending") {
    return `Approval ${args.approvalId} is already ${pending.approval.state}.`;
  }
  const snap = await deps.store.load(pending.approval.sphereId);
  if (snap === undefined) return `Sphere ${pending.approval.sphereId} not found.`;
  const imported = importSphere(snap);

  const result = await resolveApproval(
    pending.approval,
    {
      approver: { memberId: args.approverMemberId, roles: [args.approverRole], ageProfile: "adult" },
      decision: args.decision,
      at: args.now,
    },
    pending.request,
    {
      catalog: defaultCapabilityCatalog(),
      bindings: imported.bindings,
      policies: imported.policies,
      executor: deps.executor,
      audit: deps.audit,
      newApprovalId: () => args.approvalId,
    },
  );

  if (result.approval !== undefined) {
    await deps.approvals.save({ approval: result.approval, request: pending.request });
  }

  return [
    `approvalId: ${args.approvalId}`,
    `capability: ${pending.approval.action.capabilityName}`,
    `outcome: ${result.status}`,
    `reason: ${result.reason}`,
    `correlationId: ${result.correlationId}`,
  ].join("\n");
}

/** Render an action's audit chain (security facts only) for a correlation id. */
export function showAudit(reader: AuditReader, correlationId: string): string {
  const events = reader.byCorrelation(correlationId);
  if (events.length === 0) return `No audit events for ${correlationId}.`;
  return events
    .map((e) => {
      const decision = e.decision ? ` [${e.decision}]` : "";
      const policy = e.policyId ? ` (policy ${e.policyId} v${e.policyVersion})` : "";
      const reason = e.reason ? ` — ${e.reason}` : "";
      return `${e.createdAt}  ${e.type}${decision}${policy}${reason}`;
    })
    .join("\n");
}

/** Load and re-validate a snapshot, returning its documented JSON form. */
export async function exportSphereJson(store: SphereStore, id: string): Promise<string> {
  const snap = await store.load(id);
  if (snap === undefined) throw new Error(`Sphere ${id} not found`);
  // Round-trip through importSphere to validate the stored snapshot before emit.
  const validated = importSphere(snap);
  return JSON.stringify(
    exportSphere({ ...validated, exportedAt: validated.exportedAt }),
    null,
    2,
  );
}
