/**
 * Sensitive-action orchestration (ADR-001 + ADR-004 + event-model).
 *
 * Ties the capability-execution double-check to the approval lifecycle under a
 * single correlation id:
 *
 *   begin → executeCapability
 *     executed         → done
 *     denied           → done
 *     require_approval → create ApprovalRequest (emit approval.requested)
 *
 *   resolve → record an approver decision (emit approval.granted/denied)
 *     granted (quorum met) → re-run execution authorized by the grant
 *     denied               → terminal denial
 *     still pending        → awaiting more approvers
 *
 * Pure domain: composes the core; execution goes through the injected executor.
 */

import {
  createApprovalFromDecision,
  isAuthorized,
  recordApprovalDecision,
  UNIDENTIFIED_AGENT,
  type ApprovalRequest,
  type Approver,
} from "../approval/approval.js";
import type { AuditSink, KinEventType } from "../audit/events.js";
import {
  executeCapability,
  type CapabilityExecutionDeps,
  type CapabilityExecutionRequest,
} from "../capability/resolver.js";

export interface SensitiveActionDeps extends CapabilityExecutionDeps {
  /** Id factory for created ApprovalRequests. */
  readonly newApprovalId: () => string;
}

export type SensitiveActionStatus = "executed" | "denied" | "pending_approval" | "execution_failed";

export interface SensitiveActionResult {
  readonly status: SensitiveActionStatus;
  readonly correlationId: string;
  readonly reason: string;
  readonly output?: unknown;
  readonly approval?: ApprovalRequest;
  /** The original error, on `status: "execution_failed"` — preserves its type for
   * classification by the caller (RFC-028). */
  readonly error?: unknown;
}

function emitApproval(
  deps: SensitiveActionDeps,
  type: KinEventType,
  approval: ApprovalRequest,
): void {
  deps.audit?.record({
    type,
    sphereId: approval.sphereId,
    ...(approval.requestedBy.onBehalfOf !== undefined
      ? { actorId: approval.requestedBy.onBehalfOf }
      : {}),
    agentId: approval.requestedBy.agentId,
    resourceType: "capability",
    resourceId: approval.action.capabilityName,
    policyId: approval.matchedPolicyId,
    policyVersion: approval.matchedPolicyVersion,
    correlationId: approval.correlationId,
    createdAt: approval.createdAt,
  });
}

/** Start a sensitive action; raises an ApprovalRequest if approval is required. */
export async function beginSensitiveAction(
  request: CapabilityExecutionRequest,
  deps: SensitiveActionDeps,
): Promise<SensitiveActionResult> {
  const result = await executeCapability(request, deps);
  const correlationId = result.correlationId;

  if (result.outcome === "executed") {
    return { status: "executed", correlationId, reason: result.reason, output: result.output };
  }
  if (result.outcome === "denied") {
    return { status: "denied", correlationId, reason: result.reason };
  }
  if (result.outcome === "failed") {
    // RFC-028: the action was authorized but failed while executing. A terminal,
    // recorded outcome — surfaced cleanly, never a thrown crash.
    return { status: "execution_failed", correlationId, reason: result.reason, error: result.error };
  }

  // require_approval: create the ApprovalRequest and record the request event.
  const decision = result.decision;
  if (decision === undefined) {
    return { status: "denied", correlationId, reason: "require_approval without a decision" };
  }

  // Deny by default: an approval-gated action needs an identified requester.
  // Separation of duties (no self-approval) is enforced at grant time by matching
  // the approver against `requestedBy.onBehalfOf`; a subject carrying neither a
  // memberId nor an agentId is anonymous, so that check silently cannot fire and
  // the requester could answer their own request. Uncertainty is a denial, not a
  // permission (invariant: deny by default).
  if (request.subject.memberId === undefined && request.subject.agentId === undefined) {
    const reason = "An approval-gated action requires an identified requester (separation of duties cannot be enforced for an anonymous subject).";
    deps.audit?.record({
      type: "capability.denied",
      sphereId: request.context.sphereId,
      resourceType: "capability",
      resourceId: request.capabilityName,
      decision: "deny",
      reason,
      ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
      correlationId,
      createdAt: request.context.time,
    });
    return { status: "denied", correlationId, reason };
  }

  const risk = deps.catalog.get(request.capabilityName)?.risk ?? "high";
  const approval = createApprovalFromDecision({
    id: deps.newApprovalId(),
    sphereId: request.context.sphereId,
    decision,
    requestedBy: {
      agentId: request.subject.agentId ?? UNIDENTIFIED_AGENT,
      ...(request.subject.memberId !== undefined ? { onBehalfOf: request.subject.memberId } : {}),
    },
    action: {
      capabilityName: request.capabilityName,
      riskLevel: risk,
      summary: `Execute capability ${request.capabilityName}`,
    },
    createdAt: request.context.time,
  });
  emitApproval(deps, "approval.requested", approval);
  return { status: "pending_approval", correlationId, reason: result.reason, approval };
}

export interface ApproverDecisionInput {
  readonly approver: Approver;
  readonly decision: "grant" | "deny";
  readonly at: string;
  readonly reason?: string;
  /** RFC-026: the approver is the sole eligible approver → self-approval permitted. */
  readonly soleEligibleApprover?: boolean;
}

/**
 * Record an approver's decision on a pending action. On a quorum of grants the
 * one authorized action is executed; a deny is terminal; otherwise it stays
 * pending. The original request is re-supplied to run the authorized action.
 */
export async function resolveApproval(
  approval: ApprovalRequest,
  approverInput: ApproverDecisionInput,
  request: CapabilityExecutionRequest,
  deps: SensitiveActionDeps,
): Promise<SensitiveActionResult> {
  const updated = recordApprovalDecision(approval, approverInput);
  const correlationId = updated.correlationId;

  if (updated.state === "denied") {
    emitApproval(deps, "approval.denied", updated);
    return { status: "denied", correlationId, reason: "Approval denied.", approval: updated };
  }
  if (!isAuthorized(updated)) {
    return { status: "pending_approval", correlationId, reason: "Awaiting more approvers.", approval: updated };
  }

  emitApproval(deps, "approval.granted", updated);
  const result = await executeCapability(request, { ...deps, grantedApproval: updated });
  if (result.outcome === "executed") {
    return { status: "executed", correlationId, reason: result.reason, output: result.output, approval: updated };
  }
  if (result.outcome === "failed") {
    // RFC-028: the grant is a recorded decision; execution failed. Return the
    // granted approval so the caller PERSISTS it — it leaves the pending inbox
    // rather than stranding, re-grantable forever, on an action that can't succeed.
    return { status: "execution_failed", correlationId, reason: result.reason, error: result.error, approval: updated };
  }
  // A deny still dominates even a granted approval.
  return { status: "denied", correlationId, reason: result.reason, approval: updated };
}
