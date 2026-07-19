/**
 * Capability resolution and execution double-check (ADR-001).
 *
 * Realizes the per-call enforcement: even though the offered capability list is
 * pre-filtered upstream, every execution is re-checked here before the binding
 * runs:
 *   1. resolve the capability (unknown → deny);
 *   2. apply the catalog profile floor (default-deny outside allowedProfiles);
 *   3. resolve an enabled Capability Binding (none → deny by default);
 *   4. consult the Policy Engine for this specific execution;
 *   5. apply the capability/binding approval floor (allow may be raised to
 *      require_approval; deny and policy require_approval are never lowered);
 *   6. allow → execute via the CapabilityExecutor; require_approval → suspend;
 *      deny → refuse.
 *
 * Pure domain: no provider/runtime imports. Execution goes through the injected
 * CapabilityExecutor port.
 */

import { isAuthorized, type ApprovalRequest } from "../approval/approval.js";
import type { AuditSink, KinEventType } from "../audit/events.js";
import { evaluate } from "../policy/engine.js";
import {
  DEFAULT_APPROVAL_EXPIRY_SECONDS,
  type Policy,
  type PolicyDecision,
  type PolicyRequest,
} from "../policy/types.js";
import type { Capability, CapabilityBinding, CapabilityExecutor } from "./types.js";

export type CapabilityOutcome = "executed" | "requires_approval" | "denied" | "failed";

export interface CapabilityExecutionRequest {
  readonly subject: PolicyRequest["subject"];
  readonly capabilityName: string;
  readonly input?: unknown;
  readonly context: PolicyRequest["context"];
}

export interface CapabilityExecutionDeps {
  readonly catalog: ReadonlyMap<string, Capability>;
  readonly bindings: readonly CapabilityBinding[];
  readonly policies: readonly Policy[];
  readonly executor: CapabilityExecutor;
  /** Optional audit sink; when present, the execution chain is recorded. */
  readonly audit?: AuditSink;
  /**
   * A granted ApprovalRequest authorizing this one action. When a per-call
   * policy decision is require_approval, a granted approval matching this
   * capability and correlation id authorizes execution (single-use). A deny is
   * never overridden.
   */
  readonly grantedApproval?: ApprovalRequest;
}

export interface CapabilityExecutionResult {
  readonly outcome: CapabilityOutcome;
  readonly reason: string;
  readonly correlationId: string;
  readonly decision?: PolicyDecision;
  readonly output?: unknown;
  /**
   * The original error, on `outcome: "failed"` (RFC-028). The reason is the
   * user-safe message; this preserves the error's *type* for callers that must
   * classify a failure (e.g. an id collision → 409 vs a generic failure → 422).
   */
  readonly error?: unknown;
}

/** Default approver roles when an approval floor (not a policy) raises the bar. */
const FLOOR_APPROVER_ROLES = ["parent", "admin"] as const;

export async function executeCapability(
  request: CapabilityExecutionRequest,
  deps: CapabilityExecutionDeps,
): Promise<CapabilityExecutionResult> {
  const correlationId = request.context.correlationId;

  const emit = (type: KinEventType, decision?: PolicyDecision, fallbackReason?: string): void => {
    if (deps.audit === undefined) return;
    const reason = decision?.reason ?? fallbackReason;
    deps.audit.record({
      type,
      sphereId: request.context.sphereId,
      ...(request.subject.memberId !== undefined ? { actorId: request.subject.memberId } : {}),
      ...(request.subject.agentId !== undefined ? { agentId: request.subject.agentId } : {}),
      resourceType: "capability",
      resourceId: request.capabilityName,
      ...(decision !== undefined ? { decision: decision.effect } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(decision?.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision?.matchedPolicyVersion !== undefined
        ? { policyVersion: decision.matchedPolicyVersion }
        : {}),
      correlationId,
      createdAt: request.context.time,
    });
  };

  const deny = (reason: string, decision?: PolicyDecision): CapabilityExecutionResult => {
    emit("capability.denied", decision, reason);
    return { outcome: "denied", reason, correlationId, ...(decision ? { decision } : {}) };
  };

  emit("capability.requested");

  // 1. Resolve the capability. Unknown name is always denied.
  const capability = deps.catalog.get(request.capabilityName);
  if (capability === undefined) {
    return deny(`Unknown capability: ${request.capabilityName}`);
  }

  // 2. Catalog profile floor: default-deny outside allowedProfiles.
  if (!capability.allowedProfiles.includes(request.subject.ageProfile)) {
    return deny(
      `Profile '${request.subject.ageProfile}' is not allowed for capability ${capability.name}`,
    );
  }

  // 3. Resolve an enabled binding. None → deny by default.
  const binding = deps.bindings.find(
    (b) => b.capability === request.capabilityName && b.status === "enabled",
  );
  if (binding === undefined) {
    return deny(`No enabled binding for capability ${capability.name}`);
  }

  // 4. Per-call Policy Engine check, scoped to this binding's risk and execution.
  const policyRequest: PolicyRequest = {
    subject: request.subject,
    action: "execute",
    resource: {
      type: "capability",
      capabilityName: capability.name,
      riskLevel: binding.risk,
    },
    context: { ...request.context, execution: binding.execution },
  };
  let decision = evaluate(policyRequest, deps.policies);

  // 5. Approval floor: allow may be raised to require_approval; nothing lowered.
  const floor = capability.approvalFloor || binding.requiresApproval;
  if (decision.effect === "allow" && floor) {
    decision = {
      effect: "require_approval",
      reason: `Capability ${capability.name} requires approval (approval floor).`,
      ...(decision.matchedPolicyId !== undefined ? { matchedPolicyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined
        ? { matchedPolicyVersion: decision.matchedPolicyVersion }
        : {}),
      approval: {
        approverRoles: [...FLOOR_APPROVER_ROLES],
        expiresInSeconds: DEFAULT_APPROVAL_EXPIRY_SECONDS,
      },
      correlationId,
    };
  }

  // 6. Act on the decision.
  if (decision.effect === "deny") {
    return deny(decision.reason, decision);
  }
  if (decision.effect === "require_approval") {
    const g = deps.grantedApproval;
    const authorizedByGrant =
      g !== undefined &&
      isAuthorized(g) &&
      g.correlationId === correlationId &&
      g.action.capabilityName === request.capabilityName;
    if (!authorizedByGrant) {
      // The approval.requested event is emitted when the ApprovalRequest is
      // created (the suspended action does not run here).
      return { outcome: "requires_approval", reason: decision.reason, correlationId, decision };
    }
    // Fall through: a granted approval authorizes this single action.
  }
  emit("capability.allowed", decision);
  // Hand the handler the already-governed execution context (RFC-012): scope and
  // attribution only — the Policy Engine has already decided this call is allowed.
  let output: unknown;
  try {
    output = await deps.executor.execute(binding, request.input, {
      sphereId: request.context.sphereId,
      subject: request.subject,
      correlationId,
      execution: request.context.execution,
      time: request.context.time,
    });
  } catch (error) {
    // RFC-028: a governed action that fails DURING execution is a terminal
    // outcome, not a thrown crash. The authorization was real and is already
    // recorded (requested → allowed); record the failure as a security fact and
    // return it so callers surface it cleanly and never strand a granted
    // approval as pending. The message is the handler's own (an id, a status),
    // never private payload content (§18).
    const reason = error instanceof Error ? error.message : String(error);
    emit("capability.failed", decision, reason);
    return { outcome: "failed", reason, correlationId, decision, error };
  }
  emit("capability.executed", decision);
  return { outcome: "executed", reason: decision.reason, correlationId, decision, output };
}
