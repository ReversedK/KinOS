/**
 * Authorized capability surface (RFC-007, ADR-001).
 *
 * Computes the deny-by-default set of capabilities the Policy Engine authorizes
 * for one subject (agent identity). This is the source of:
 *   - `allowedTools` in the per-agent runtime config projection (RuntimeConfigProjection);
 *   - the tool list the Sphere MCP *offers* a calling agent.
 *
 * It is the "first filter" only: ADR-001's per-call double-check still runs at
 * execution time (capability/resolver.ts). A capability appears here when, and
 * only when, the catalog profile floor admits the subject and the Policy Engine
 * does not deny it. `require_approval` is offered but flagged — the call will be
 * approval-gated. When bindings are supplied, a capability with no enabled
 * binding is not offered (deny by default; no concrete tool to bind to).
 *
 * Pure domain: no provider/runtime imports.
 */

import { evaluate } from "../policy/engine.js";
import type { Policy, PolicyRequest, RiskLevel } from "../policy/types.js";
import type { Capability, CapabilityBinding } from "./types.js";

export interface AuthorizedCapability {
  readonly name: string;
  readonly risk: RiskLevel;
  /** True when the call will be approval-gated (policy require_approval or a floor). */
  readonly requiresApproval: boolean;
}

export interface AuthorizedSurfaceDeps {
  readonly catalog: ReadonlyMap<string, Capability>;
  readonly policies: readonly Policy[];
  /** When provided, restrict the surface to capabilities with an enabled binding. */
  readonly bindings?: readonly CapabilityBinding[];
  /**
   * The calling agent's declared capability scope (RFC-027). When provided, a
   * capability outside the scope is not offered — the agent's surface is the
   * intersection of what policy authorizes and what it was deployed for. Scope only
   * narrows; it never grants. Omit for non-agent callers (no per-agent narrowing).
   */
  readonly agentScope?: readonly string[];
}

/**
 * Resolve the authorized capability surface for a subject. Deterministic and
 * order-stable (sorted by capability name).
 */
export function resolveAuthorizedCapabilities(
  subject: PolicyRequest["subject"],
  context: PolicyRequest["context"],
  deps: AuthorizedSurfaceDeps,
): readonly AuthorizedCapability[] {
  const offered: AuthorizedCapability[] = [];

  for (const cap of deps.catalog.values()) {
    // 1. Catalog profile floor: a profile not listed is denied for this capability.
    if (!cap.allowedProfiles.includes(subject.ageProfile)) continue;

    // 1b. Per-agent scope (RFC-027): when a scope is supplied, a capability outside
    //     it is not offered — the surface is policy ∩ declared scope. Scope only
    //     narrows; an empty scope offers nothing (deny by default).
    if (deps.agentScope !== undefined && !deps.agentScope.includes(cap.name)) continue;

    // 2. When bindings are supplied, an unbound capability has no concrete tool
    //    and is not offered (deny by default).
    const binding =
      deps.bindings === undefined
        ? undefined
        : deps.bindings.find((b) => b.capability === cap.name && b.status === "enabled");
    if (deps.bindings !== undefined && binding === undefined) continue;

    // 3. Policy Engine decides for this capability (scoped to the binding's risk
    //    and execution where a binding exists, else the catalog risk).
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: {
          type: "capability",
          capabilityName: cap.name,
          riskLevel: binding?.risk ?? cap.risk,
        },
        context: binding !== undefined ? { ...context, execution: binding.execution } : context,
      },
      deps.policies,
    );
    if (decision.effect === "deny") continue;

    offered.push({
      name: cap.name,
      risk: binding?.risk ?? cap.risk,
      requiresApproval:
        decision.effect === "require_approval" || cap.approvalFloor || (binding?.requiresApproval ?? false),
    });
  }

  return offered.sort((a, b) => a.name.localeCompare(b.name));
}
