/**
 * Capability and Capability Binding (domain-model.md, ADR-001,
 * capability-catalog.md).
 *
 * Capabilities are the stable internal API: agents request capabilities, never
 * raw tools/workflows/APIs. A Capability Binding maps one capability to one
 * concrete runtime/adapter operation; the provider-specific `runtimeToolName`
 * is an adapter detail that must never leak into the domain reasoning or audit.
 *
 * Pure domain: no provider/runtime imports.
 */

import type { AgeProfile, RiskLevel } from "../policy/types.js";

export interface Capability {
  /** Stable lowercase-dotted name, e.g. "calendar.create_event". */
  readonly name: string;
  readonly description: string;
  readonly risk: RiskLevel;
  /** Default-deny: a profile not listed is denied for this capability. */
  readonly allowedProfiles: readonly AgeProfile[];
  /** A floor: policy may raise to require_approval; the runtime may never lower. */
  readonly approvalFloor: boolean;
  /** Metadata facts to audit — never private content. */
  readonly auditFacts: readonly string[];
}

export interface CapabilityBinding {
  readonly capability: string;
  readonly runtime: "hermes" | "local" | "n8n" | "custom";
  /** Provider-specific operation name; adapter detail, never used in domain reasoning. */
  readonly runtimeToolName: string;
  readonly execution: "local" | "cloud";
  readonly risk: RiskLevel;
  /** Binding-level approval floor; policy may raise it, runtime may not lower it. */
  readonly requiresApproval: boolean;
  readonly status: "proposed" | "enabled" | "disabled" | "deprecated" | "removed";
}

/**
 * Port that runs a resolved binding. Implemented by adapters outside the core
 * (a local executor, an n8n adapter, …). The domain never calls a provider
 * directly; it hands an authorized binding + input to this port.
 */
export interface CapabilityExecutor {
  execute(binding: CapabilityBinding, input: unknown): Promise<unknown>;
}
