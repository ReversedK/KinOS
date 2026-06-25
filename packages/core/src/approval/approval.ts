/**
 * Approval and escalation (ADR-004).
 *
 * An ApprovalRequest is created only from a Policy Engine `require_approval`
 * decision and suspends an action until an authorized human resolves it.
 * Humans answer; agents and models never self-approve. Fail closed: no eligible
 * approver, expiry or ambiguity all resolve to denial.
 *
 * Pure domain: no I/O, no provider/runtime imports. Date arithmetic is plain
 * computation; ids and timestamps are supplied by the caller.
 */

import type { AgeProfile, PolicyDecision, RiskLevel } from "../policy/types.js";

export type ApprovalState = "pending" | "granted" | "denied" | "expired" | "cancelled";

export interface ApprovalDecisionRecord {
  readonly approverMemberId: string;
  readonly decision: "grant" | "deny";
  readonly at: string;
  readonly reason?: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly sphereId: string;
  readonly correlationId: string;
  readonly requestedBy: {
    readonly agentId: string;
    readonly onBehalfOf?: string;
  };
  readonly action: {
    readonly capabilityName: string;
    readonly riskLevel: RiskLevel;
    /** User-safe description, never private content. */
    readonly summary: string;
    readonly payloadRef?: string;
  };
  readonly matchedPolicyId: string;
  readonly matchedPolicyVersion: number;
  readonly approverRoles: readonly string[];
  readonly quorum: number;
  readonly state: ApprovalState;
  readonly decisions: readonly ApprovalDecisionRecord[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** A human candidate to answer an approval (resolved from Sphere membership). */
export interface Approver {
  readonly memberId: string;
  readonly roles: readonly string[];
  readonly ageProfile: AgeProfile;
  /** Defaults to true; a non-active member cannot approve. */
  readonly active?: boolean;
}

export interface CreateApprovalInput {
  readonly id: string;
  readonly sphereId: string;
  readonly decision: PolicyDecision;
  readonly requestedBy: ApprovalRequest["requestedBy"];
  readonly action: ApprovalRequest["action"];
  readonly createdAt: string;
  readonly quorum?: number;
}

/**
 * Create exactly one pending ApprovalRequest from a `require_approval` decision,
 * carrying the originating correlation id and the deciding policy.
 */
export function createApprovalFromDecision(input: CreateApprovalInput): ApprovalRequest {
  const d = input.decision;
  if (d.effect !== "require_approval") {
    throw new Error("createApprovalFromDecision requires a require_approval decision");
  }
  if (d.matchedPolicyId === undefined || d.matchedPolicyVersion === undefined) {
    throw new Error("require_approval decision must cite the deciding policy");
  }
  const approval = d.approval;
  if (approval === undefined) {
    throw new Error("require_approval decision must carry approver roles and expiry");
  }
  const quorum = input.quorum ?? 1;
  if (quorum < 1) throw new Error("quorum must be at least 1");

  return {
    id: input.id,
    sphereId: input.sphereId,
    correlationId: d.correlationId,
    requestedBy: input.requestedBy,
    action: input.action,
    matchedPolicyId: d.matchedPolicyId,
    matchedPolicyVersion: d.matchedPolicyVersion,
    approverRoles: [...approval.approverRoles],
    quorum,
    state: "pending",
    decisions: [],
    createdAt: input.createdAt,
    expiresAt: addSeconds(input.createdAt, approval.expiresInSeconds),
  };
}

export interface RecordDecisionInput {
  readonly approver: Approver;
  readonly decision: "grant" | "deny";
  readonly at: string;
  readonly reason?: string;
}

/**
 * Record an approver's decision and recompute state. Eligibility is enforced:
 * an active member holding an approver role, who is neither the requesting
 * subject (separation of duties) nor a minor. Deny dominates; quorum distinct
 * grants are required to grant. Duplicate decisions by the same approver are
 * ignored. A resolved request cannot be decided again.
 */
export function recordApprovalDecision(
  request: ApprovalRequest,
  input: RecordDecisionInput,
): ApprovalRequest {
  if (request.state !== "pending") {
    throw new Error(`Cannot decide an approval in state '${request.state}'; it must be pending`);
  }
  assertEligible(request, input.approver);

  // Duplicate decision by the same approver does not count twice.
  if (request.decisions.some((x) => x.approverMemberId === input.approver.memberId)) {
    return request;
  }

  const decisions: ApprovalDecisionRecord[] = [
    ...request.decisions,
    {
      approverMemberId: input.approver.memberId,
      decision: input.decision,
      at: input.at,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    },
  ];

  const state = resolveState(decisions, request.quorum);
  return { ...request, decisions, state };
}

/** Expire a pending request whose deadline has passed; expiry resolves as denial. */
export function expireIfDue(request: ApprovalRequest, now: string): ApprovalRequest {
  if (request.state !== "pending") return request;
  if (Date.parse(now) >= Date.parse(request.expiresAt)) {
    return { ...request, state: "expired" };
  }
  return request;
}

/** The requesting subject withdraws the action before resolution. */
export function cancelApproval(request: ApprovalRequest, _at: string): ApprovalRequest {
  if (request.state !== "pending") {
    throw new Error(`Cannot cancel an approval in state '${request.state}'`);
  }
  return { ...request, state: "cancelled" };
}

/** Only a granted approval authorizes the pending action (and only once). */
export function isAuthorized(request: ApprovalRequest): boolean {
  return request.state === "granted";
}

function assertEligible(request: ApprovalRequest, approver: Approver): void {
  if (approver.active === false) {
    throw new Error("Approver is not an active member of the Sphere");
  }
  if (approver.ageProfile === "child" || approver.ageProfile === "teen") {
    throw new Error("A minor cannot approve a sensitive action");
  }
  if (
    request.requestedBy.onBehalfOf !== undefined &&
    approver.memberId === request.requestedBy.onBehalfOf
  ) {
    throw new Error("The requester cannot approve their own request (separation of duties)");
  }
  if (!approver.roles.some((r) => request.approverRoles.includes(r))) {
    throw new Error("Approver does not hold a required approver role");
  }
}

function resolveState(decisions: readonly ApprovalDecisionRecord[], quorum: number): ApprovalState {
  if (decisions.some((d) => d.decision === "deny")) return "denied";
  const grants = new Set(
    decisions.filter((d) => d.decision === "grant").map((d) => d.approverMemberId),
  );
  return grants.size >= quorum ? "granted" : "pending";
}

function addSeconds(iso: string, seconds: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Malformed timestamp: ${iso}`);
  return new Date(ms + seconds * 1000).toISOString();
}
