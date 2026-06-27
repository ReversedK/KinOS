/**
 * Sphere MCP — the governed capability gateway (RFC-007, integration-model.md).
 *
 * One gateway per Sphere, permissioned per calling-agent identity. Every call
 * runs the full governance chain:
 *
 *   credential -> agent identity -> Policy Engine -> capability execution
 *               -> authorized result only
 *
 * Two properties this module guarantees (coding principles 2, 4):
 *   - Authorization is anchored to the **agent credential**, never to an identity
 *     asserted inside the call. The subject is taken solely from token resolution;
 *     anything in `call.input` is opaque payload, never an identity claim.
 *   - Deny by default: an unknown/empty credential is refused before any policy
 *     check; an unbound or unauthorized capability is denied.
 *
 * It composes the existing sensitive-action flow (the per-call double-check and
 * the approval lifecycle) — it adds no new authorization. Pure domain: the MCP
 * transport itself is an adapter; this is the governed dispatch behind it.
 */

import type { ApprovalRequest } from "../approval/approval.js";
import { beginSensitiveAction, type SensitiveActionDeps } from "../flow/sensitive-action.js";
import type { CapabilityExecutionRequest } from "../capability/resolver.js";
import type { PolicyRequest } from "../policy/types.js";

export interface SphereMcpCall {
  /** The agent's scoped credential. Resolves to the calling identity. */
  readonly token: string;
  readonly capabilityName: string;
  /** Opaque tool payload — never an identity assertion. */
  readonly input?: unknown;
}

export interface ResolvedAgentIdentity {
  readonly agentId: string;
  /** The policy subject for this agent — derived from the credential, authoritative. */
  readonly subject: PolicyRequest["subject"];
}

export interface SphereMcpDeps extends SensitiveActionDeps {
  readonly sphereId: string;
  /** credential -> agent identity. Unknown/empty token -> undefined (deny by default). */
  readonly resolveAgentByToken: (token: string) => ResolvedAgentIdentity | undefined;
  readonly now: () => string;
  readonly newCorrelationId: () => string;
}

export type SphereMcpStatus = "ok" | "denied" | "pending_approval" | "unauthenticated";

export interface SphereMcpResult {
  readonly status: SphereMcpStatus;
  readonly correlationId: string;
  readonly reason: string;
  readonly output?: unknown;
  /** When pending_approval, the raised request — the adapter persists it. */
  readonly approval?: ApprovalRequest;
}

export async function handleSphereMcpCall(call: SphereMcpCall, deps: SphereMcpDeps): Promise<SphereMcpResult> {
  const correlationId = deps.newCorrelationId();
  const time = deps.now();

  // Authenticate the credential first. Unknown/empty -> refuse before any policy.
  const identity = call.token.trim() === "" ? undefined : deps.resolveAgentByToken(call.token);
  if (identity === undefined) {
    deps.audit?.record({
      type: "capability.denied",
      sphereId: deps.sphereId,
      resourceType: "capability",
      resourceId: call.capabilityName,
      decision: "deny",
      reason: "Unauthenticated credential at the Sphere MCP gateway.",
      correlationId,
      createdAt: time,
    });
    return { status: "unauthenticated", correlationId, reason: "Unauthenticated credential." };
  }

  // The request's subject is the resolved identity — never anything in the call.
  const request: CapabilityExecutionRequest = {
    subject: identity.subject,
    capabilityName: call.capabilityName,
    input: call.input ?? {},
    context: { sphereId: deps.sphereId, time, execution: "local", correlationId },
  };

  const result = await beginSensitiveAction(request, deps);
  if (result.status === "executed") {
    return { status: "ok", correlationId, reason: result.reason, output: result.output };
  }
  if (result.status === "pending_approval") {
    return {
      status: "pending_approval",
      correlationId,
      reason: result.reason,
      ...(result.approval !== undefined ? { approval: result.approval } : {}),
    };
  }
  return { status: "denied", correlationId, reason: result.reason };
}
