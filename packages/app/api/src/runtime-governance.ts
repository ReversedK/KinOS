/**
 * Runtime-governance side effects (RFC-007, ADR-007).
 *
 * The executor-side work behind the mutating runtime-governance capabilities.
 * `projectAgentConfig` is the `runtime.config.project` side effect: it computes
 * the agent's RuntimeConfigProjection (for the agent's OWN policy scope, not the
 * admin caller), provisions/rotates the per-agent Sphere-MCP token, and writes
 * the agent's runtime profile (Hermes `config.yaml` + `.env`). KinOS owns the
 * config; the agent never edits it.
 *
 * It runs only after the governed pipeline has authorized the call (policy +
 * approval floor) — this is the binding target, not an authorization point. The
 * token value lands only in the profile `.env`; the projection/config reference
 * it by env var (ADR-007). Returns security facts only (version, tool surface,
 * path) — never the token value.
 */

import {
  ageProfileForRole,
  defaultCapabilityCatalog,
  importSphere,
  projectAgentRuntimeConfig,
  type AgentTokenStore,
  type AuditSink,
  type PolicyRequest,
  type Role,
  type SphereStore,
} from "@kinos/core";
import { writeHermesProfile, type HermesFsPort } from "@kinos/runtime-hermes";

export interface RuntimeProjectInput {
  readonly sphereId?: string;
  readonly agentId?: string;
  readonly correlationId?: string;
}

export interface RuntimeGovernanceDeps {
  readonly store: SphereStore;
  readonly tokens: AgentTokenStore;
  /** Runtime profile home root (e.g. the Hermes data volume). */
  readonly home: string;
  readonly fs: HermesFsPort;
  /** The Sphere MCP endpoint the projected config points the agent's runtime at. */
  readonly gatewayEndpoint: (sphereId: string, agentId: string) => string;
  readonly auditSink?: AuditSink;
  readonly now?: () => string;
}

export interface RuntimeProjectResult {
  readonly agentId: string;
  readonly version: number;
  readonly allowedTools: readonly string[];
  readonly configPath: string;
}

export async function projectAgentConfig(
  deps: RuntimeGovernanceDeps,
  input: RuntimeProjectInput,
): Promise<RuntimeProjectResult> {
  const sphereId = input.sphereId;
  const agentId = input.agentId;
  if (typeof sphereId !== "string" || typeof agentId !== "string") {
    throw new Error("runtime.config.project requires input.sphereId and input.agentId");
  }
  const snap = await deps.store.load(sphereId);
  if (snap === undefined) throw new Error(`Sphere ${sphereId} not found`);
  const agent = snap.agents.find((a) => a.id === agentId);
  if (agent === undefined) throw new Error(`Agent ${agentId} not found`);
  const owner = snap.sphere.members.find((m) => m.id === agent.ownerId);
  if (owner === undefined) throw new Error(`Agent ${agentId} has no resolvable owner`);

  const stamp = (deps.now ?? (() => new Date().toISOString()))();
  const correlationId = input.correlationId ?? `proj-${stamp}`;
  const imported = importSphere(snap);

  // The projection reflects the AGENT's own policy scope (owner-derived subject).
  const subject: PolicyRequest["subject"] = {
    agentId: agent.id,
    memberId: owner.id,
    role: owner.role,
    ageProfile: ageProfileForRole(owner.role as Role),
  };

  // Provision/rotate the per-agent token (ADR-007). Stable secretRef across
  // rotation; the raw value is written only to the profile `.env` below.
  const provisioned = await deps.tokens.provision(sphereId, agentId);

  const projection = projectAgentRuntimeConfig({
    agentId,
    subject,
    runtimeConfig: imported.runtimeConfig,
    catalog: defaultCapabilityCatalog(),
    policies: imported.policies,
    bindings: imported.bindings,
    context: { sphereId, time: stamp, execution: "local", correlationId },
    gatewayEndpoint: deps.gatewayEndpoint(sphereId, agentId),
    authSecretRef: provisioned.record.secretRef,
    version: 1,
  });

  const configPath = await writeHermesProfile(projection, {
    home: deps.home,
    fs: deps.fs,
    token: provisioned.token,
  });

  // Audit the token provisioning as a security fact (never the value).
  deps.auditSink?.record({
    type: "runtime.token.provisioned",
    sphereId,
    agentId,
    resourceType: "agent",
    resourceId: agentId,
    decision: "executed",
    reason: `secretRef=${provisioned.record.secretRef}`,
    correlationId,
    createdAt: stamp,
  });

  return { agentId, version: projection.version, allowedTools: projection.gateway.allowedTools, configPath };
}
