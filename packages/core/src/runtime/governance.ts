/**
 * Runtime-governance capability bindings (RFC-007, ADR-007).
 *
 * The mutating runtime-governance capabilities (`runtime.config.project`,
 * `runtime.session.backup`, `runtime.session.restore`) are executed like any
 * other capability: through the policy double-check + approval flow, then a
 * Capability Binding to a concrete executor tool. These are the default bindings
 * that map those capabilities to the local runtime-governance executor tools.
 *
 * Risk is high; the approval floor is carried by the catalog (project + restore
 * require approval, backup does not) — bindings never lower it. The server adds
 * these to a Sphere's bindings when running the governed runtime-management
 * endpoints, so the same pipeline (begin → approve → execute) applies.
 *
 * Pure domain: the tool names are an executor detail (an adapter implements
 * them), but binding a capability to a tool name is domain config.
 */

import type { CapabilityBinding } from "../capability/types.js";

/** capability name -> executor tool name. */
export const RUNTIME_GOVERNANCE_TOOLS = {
  "runtime.config.project": "runtime.project",
  "runtime.session.backup": "runtime.backup",
  "runtime.session.restore": "runtime.restore",
} as const;

export type RuntimeGovernanceCapability = keyof typeof RUNTIME_GOVERNANCE_TOOLS;

/** The default enabled bindings for the runtime-governance capabilities. */
export function runtimeGovernanceBindings(): CapabilityBinding[] {
  return (Object.entries(RUNTIME_GOVERNANCE_TOOLS) as [RuntimeGovernanceCapability, string][]).map(
    ([capability, runtimeToolName]) => ({
      capability,
      runtime: "local",
      runtimeToolName,
      execution: "local",
      risk: "high",
      requiresApproval: false, // the catalog approval floor governs project/restore
      status: "enabled",
    }),
  );
}
