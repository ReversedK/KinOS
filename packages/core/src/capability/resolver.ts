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

import { evaluate } from "../policy/engine.js";
import {
  DEFAULT_APPROVAL_EXPIRY_SECONDS,
  type Policy,
  type PolicyDecision,
  type PolicyRequest,
} from "../policy/types.js";
import type { Capability, CapabilityBinding, CapabilityExecutor } from "./types.js";

export type CapabilityOutcome = "executed" | "requires_approval" | "denied";

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
}

export interface CapabilityExecutionResult {
  readonly outcome: CapabilityOutcome;
  readonly reason: string;
  readonly correlationId: string;
  readonly decision?: PolicyDecision;
  readonly output?: unknown;
}

/** Default approver roles when an approval floor (not a policy) raises the bar. */
const FLOOR_APPROVER_ROLES = ["parent", "admin"] as const;

export async function executeCapability(
  request: CapabilityExecutionRequest,
  deps: CapabilityExecutionDeps,
): Promise<CapabilityExecutionResult> {
  const correlationId = request.context.correlationId;
  const deny = (reason: string): CapabilityExecutionResult => ({ outcome: "denied", reason, correlationId });

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
    return { outcome: "denied", reason: decision.reason, correlationId, decision };
  }
  if (decision.effect === "require_approval") {
    return { outcome: "requires_approval", reason: decision.reason, correlationId, decision };
  }
  const output = await deps.executor.execute(binding, request.input);
  return { outcome: "executed", reason: decision.reason, correlationId, decision, output };
}
