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

import type { AgeProfile, PolicyRequest, RiskLevel } from "../policy/types.js";

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
  /**
   * JSON Schema for the capability's input (capability-catalog.md). Surfaced to the
   * runtime as the tool's `inputSchema` (RFC-007) so an agent knows the exact
   * arguments — a required id, a query, etc. Omitted → a permissive object schema.
   */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
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
 * The already-governed facts a handler may need to run a stateful adapter
 * correctly (RFC-012): which Sphere, which acting subject, the correlation id.
 *
 * It is **descriptive, not an authorization input**: every decision it reports was
 * already made upstream by the Policy Engine. A handler must never branch on it to
 * grant or widen access (the runtime is a second line of defence, not the first).
 * Its purpose is scoping and attribution — e.g. a Sphere-scoped calendar reads
 * `sphereId` from here, never from agent-supplied `tools/call` input, so an agent
 * cannot reach another Sphere's data by lying about a Sphere id.
 */
export interface ExecutionContext {
  readonly sphereId: string;
  readonly subject: PolicyRequest["subject"];
  readonly correlationId: string;
  readonly execution: "local" | "cloud";
  readonly time: string;
}

/**
 * Port that runs a resolved binding. Implemented by adapters outside the core
 * (a local executor, an n8n adapter, …). The domain never calls a provider
 * directly; it hands an authorized binding + input to this port.
 *
 * `context` is optional and additive (RFC-012): handlers that don't need scope or
 * attribution ignore it and are unchanged.
 */
export interface CapabilityExecutor {
  execute(binding: CapabilityBinding, input: unknown, context?: ExecutionContext): Promise<unknown>;
}
