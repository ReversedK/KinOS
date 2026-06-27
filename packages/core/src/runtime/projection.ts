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
 *   - the native-tool allow-list is deny-by-default (empty unless given);
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
  /** Deny-by-default allow-list of runtime-native tools. */
  readonly nativeToolsAllow: readonly string[];
  /** KinOS owns the tool surface; the runtime never installs its own. */
  readonly autonomousInstallDisabled: true;
  readonly version: number;
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
  /** Optional boring model swap (RFC-004) — never escalates provider/execution. */
  readonly agentModelPreference?: string;
  /** Deny-by-default native-tool allow-list (empty unless explicitly provided). */
  readonly nativeToolsAllow?: readonly string[];
  readonly version: number;
}

export function projectAgentRuntimeConfig(input: ProjectAgentRuntimeConfigInput): RuntimeConfigProjection {
  if (input.authSecretRef.trim() === "") {
    throw new Error("A per-agent credential reference is required (credentials by reference only)");
  }

  const profile = resolveEffectiveProfile(input.runtimeConfig, input.agentModelPreference);
  // Deny by default: never project a provider/execution the Sphere does not allow.
  assertProfileAllowed(input.runtimeConfig, profile);

  const allowedTools = resolveAuthorizedCapabilities(input.subject, input.context, {
    catalog: input.catalog,
    policies: input.policies,
    ...(input.bindings !== undefined ? { bindings: input.bindings } : {}),
  }).map((c) => c.name);

  return {
    agentId: input.agentId,
    sphereId: input.context.sphereId,
    profile,
    gateway: {
      endpoint: input.gatewayEndpoint,
      authSecretRef: input.authSecretRef,
      allowedTools,
    },
    nativeToolsAllow: input.nativeToolsAllow ?? [],
    autonomousInstallDisabled: true,
    version: input.version,
  };
}
