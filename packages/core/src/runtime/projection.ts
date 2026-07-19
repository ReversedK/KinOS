/**
 * RuntimeConfigProjection (RFC-007, domain-model.md).
 *
 * The governed, per-agent runtime configuration KinOS derives from Sphere config
 * and the agent's policy scope, then writes to the agent's runtime instance. The
 * domain owns the projection; the runtime never edits its own governance config.
 *
 * Provider-agnostic by design: this module names no concrete runtime (no
 * "Hermes", no `~/.hermes/config.yaml`). The adapter realizes the projection as
 * that runtime's profile/config file plus a scoped credential. Consequences
 * baked in here (coding principle 6, RFC-007):
 *   - exactly one Sphere gateway (the Sphere MCP) is registered — no others;
 *   - `allowedTools` = the deny-by-default authorized capability surface;
 *   - `nativeToolsetsAllow` = the granted native toolsets (RFC-025): the runtime
 *     may use these of its OWN native tools; deny-by-default (empty unless a
 *     `native.<toolset>` capability is authorized). A distinct channel from the
 *     Sphere-MCP surface — native grants are never offered as MCP tools;
 *   - autonomous tool/integration install is disabled (KinOS owns the surface);
 *   - the per-agent credential is held by reference only, never inline.
 *
 * Pure domain: no provider/runtime imports.
 */

import { resolveAuthorizedCapabilities } from "../capability/surface.js";
import type { Capability, CapabilityBinding } from "../capability/types.js";
import type { Policy, PolicyRequest } from "../policy/types.js";
import { assertProfileAllowed, resolveEffectiveProfile, type RuntimeProfile, type SphereRuntimeConfig } from "./profile.js";

/** The single governed gateway (Sphere MCP) registered in an agent's runtime. */
export interface SphereGatewayProjection {
  /** Local-first endpoint reference of the Sphere MCP gateway. */
  readonly endpoint: string;
  /** The agent's scoped credential — a secret-store reference, never the value. */
  readonly authSecretRef: string;
  /** The capabilities the Policy Engine authorizes for this agent (deny by default). */
  readonly allowedTools: readonly string[];
}

export interface RuntimeConfigProjection {
  readonly agentId: string;
  readonly sphereId: string;
  /** Provider/model (RFC-004); secrets by reference only. */
  readonly profile: RuntimeProfile;
  /** Exactly one gateway — the Sphere MCP. No other tool surface is registered. */
  readonly gateway: SphereGatewayProjection;
  /**
   * Deny-by-default granted native toolsets (RFC-025), derived from authorized
   * `native.<toolset>` capabilities — e.g. `["web", "cron"]`. The runtime adapter
   * maps these to its native toolset allow-list; the hard floor (native memory,
   * terminal, file, code execution) is enforced by the adapter and is never here.
   */
  readonly nativeToolsetsAllow: readonly string[];
  /** KinOS owns the tool surface; the runtime never installs its own. */
  readonly autonomousInstallDisabled: true;
  readonly version: number;
}

/** A `native.<toolset>` capability names a runtime-native toolset, not an MCP tool. */
const NATIVE_PREFIX = "native.";
export function isNativeToolsetCapability(name: string): boolean {
  return name.startsWith(NATIVE_PREFIX);
}
/** The toolset a `native.<toolset>` capability grants (e.g. `native.web` → `web`). */
export function toolsetOf(nativeCapabilityName: string): string {
  return nativeCapabilityName.slice(NATIVE_PREFIX.length);
}

export interface ProjectAgentRuntimeConfigInput {
  readonly agentId: string;
  /** The agent's identity, for policy-scoping the authorized surface. */
  readonly subject: PolicyRequest["subject"];
  readonly runtimeConfig: SphereRuntimeConfig;
  readonly catalog: ReadonlyMap<string, Capability>;
  readonly policies: readonly Policy[];
  readonly context: PolicyRequest["context"];
  /** Sphere MCP gateway endpoint reference (local-first). */
  readonly gatewayEndpoint: string;
  /** Per-agent scoped credential reference (secret-store ref, never the value). */
  readonly authSecretRef: string;
  /** Optional binding set; restricts allowedTools to bound capabilities. */
  readonly bindings?: readonly CapabilityBinding[];
  /** The agent's declared capability scope (RFC-027): the surface is narrowed to it. */
  readonly agentScope?: readonly string[];
  /** Optional boring model swap (RFC-004) — never escalates provider/execution. */
  readonly agentModelPreference?: string;
  readonly version: number;
}

export function projectAgentRuntimeConfig(input: ProjectAgentRuntimeConfigInput): RuntimeConfigProjection {
  if (input.authSecretRef.trim() === "") {
    throw new Error("A per-agent credential reference is required (credentials by reference only)");
  }

  const profile = resolveEffectiveProfile(input.runtimeConfig, input.agentModelPreference);
  // Deny by default: never project a provider/execution the Sphere does not allow.
  assertProfileAllowed(input.runtimeConfig, profile);

  const authorized = resolveAuthorizedCapabilities(input.subject, input.context, {
    catalog: input.catalog,
    policies: input.policies,
    ...(input.bindings !== undefined ? { bindings: input.bindings } : {}),
    ...(input.agentScope !== undefined ? { agentScope: input.agentScope } : {}),
  }).map((c) => c.name);

  // Split the authorized surface into two distinct channels (RFC-025):
  //   - MCP tools: everything reachable through the Sphere MCP gateway;
  //   - native toolsets: `native.<toolset>` grants the runtime realizes itself.
  // A native grant is never offered as an MCP tool, and vice versa.
  const allowedTools = authorized.filter((name) => !isNativeToolsetCapability(name));
  const nativeToolsetsAllow = authorized.filter(isNativeToolsetCapability).map(toolsetOf);

  return {
    agentId: input.agentId,
    sphereId: input.context.sphereId,
    profile,
    gateway: {
      endpoint: input.gatewayEndpoint,
      authSecretRef: input.authSecretRef,
      allowedTools,
    },
    nativeToolsetsAllow,
    autonomousInstallDisabled: true,
    version: input.version,
  };
}
