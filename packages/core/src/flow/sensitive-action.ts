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

export type SensitiveActionStatus = "executed" | "denied" | "pending_approval";

export interface SensitiveActionResult {
  readonly status: SensitiveActionStatus;
  readonly correlationId: string;
  readonly reason: string;
  readonly output?: unknown;
  readonly approval?: ApprovalRequest;
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

  // require_approval: create the ApprovalRequest and record the request event.
  const decision = result.decision;
  if (decision === undefined) {
    return { status: "denied", correlationId, reason: "require_approval without a decision" };
  }
  const risk = deps.catalog.get(request.capabilityName)?.risk ?? "high";
  const approval = createApprovalFromDecision({
    id: deps.newApprovalId(),
    sphereId: request.context.sphereId,
    decision,
    requestedBy: {
      agentId: request.subject.agentId ?? "unknown",
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
  // A deny still dominates even a granted approval.
  return { status: "denied", correlationId, reason: result.reason, approval: updated };
}
