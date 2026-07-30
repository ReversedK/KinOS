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
  effectiveAgeProfile,
  assertSnapshotRestorable,
  createRuntimeStateSnapshot,
  defaultCapabilityCatalog,
  defaultMemoryBindings,
  defaultMemoryPolicy,
  exportSphere,
  importSphere,
  projectAgentRuntimeConfig,
  setCloudInference,
  type AgentTokenStore,
  type AuditSink,
  type PolicyRequest,
  type Role,
  type RuntimeProviderId,
  type RuntimeStateBlobStore,
  type SnapshotStore,
  type SphereStore,
} from "@kinos/core";
import { hermesProfileDir, writeHermesProfile, type HermesFsPort } from "@kinos/runtime-hermes";

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
  /**
   * Deployment fallback for where a provider is reached, used only when the
   * Sphere's governed profile (RFC-004) does not pin a baseUrl itself. Without it
   * a projected profile would send the Harness to the provider's default address
   * — inside the Hermes container, where nothing is listening. It never overrides
   * an operator's explicit choice and grants nothing: it is an address, not
   * authorization.
   */
  readonly providerBaseUrl?: (providerId: string) => string | undefined;
  readonly auditSink?: AuditSink;
  readonly now?: () => string;
  /** Session backup/restore (RFC-007). Absent → backup/restore unavailable. */
  readonly snapshots?: SnapshotStore;
  readonly blobs?: RuntimeStateBlobStore;
  readonly newSnapshotId?: () => string;
}

function profileDir(home: string, agentId: string): string {
  return hermesProfileDir(home, agentId);
}

async function loadAgent(deps: RuntimeGovernanceDeps, sphereId: unknown, agentId: unknown): Promise<{ sphereId: string; agentId: string }> {
  if (typeof sphereId !== "string" || typeof agentId !== "string") {
    throw new Error("input.sphereId and input.agentId are required");
  }
  const snap = await deps.store.load(sphereId);
  if (snap === undefined) throw new Error(`Sphere ${sphereId} not found`);
  if (snap.agents.find((a) => a.id === agentId) === undefined) throw new Error(`Agent ${agentId} not found`);
  return { sphereId, agentId };
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
    ageProfile: effectiveAgeProfile(owner),
  };

  // Provision/rotate the per-agent token (ADR-007). Stable secretRef across
  // rotation; the raw value is written only to the profile `.env` below.
  const provisioned = await deps.tokens.provision(sphereId, agentId);

  // Fill in the provider address only where the governed profile left it open.
  const governedProfile = imported.runtimeConfig.defaultProfile;
  const fallbackBaseUrl = governedProfile.baseUrl ?? deps.providerBaseUrl?.(governedProfile.providerId);
  const runtimeConfig =
    fallbackBaseUrl === undefined || governedProfile.baseUrl !== undefined
      ? imported.runtimeConfig
      : { ...imported.runtimeConfig, defaultProfile: { ...governedProfile, baseUrl: fallbackBaseUrl } };

  const projection = projectAgentRuntimeConfig({
    agentId,
    subject,
    runtimeConfig,
    // The agent's governed default model (RFC-009) must reach its Hermes profile:
    // Hermes runs on exactly the model KinOS decided, not the Sphere default.
    ...(agent.modelPreference !== undefined ? { agentModelPreference: agent.modelPreference } : {}),
    catalog: defaultCapabilityCatalog(),
    // RFC-043: built-in agent memory — always available, so the projected surface
    // (Hermes tools.include) lists memory.capture/search even with no package.
    policies: [...imported.policies, defaultMemoryPolicy(sphereId)],
    bindings: [...imported.bindings, ...defaultMemoryBindings()],
    // RFC-027: the projected surface is narrowed to the agent's declared scope.
    agentScope: agent.enabledCapabilities,
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

export interface RuntimeCloudInput {
  readonly sphereId?: string;
  /** Cloud providers to permit when enabling (ignored on disable). */
  readonly allowProviders?: readonly string[];
  readonly correlationId?: string;
}

export interface RuntimeCloudResult {
  readonly cloudInferenceEnabled: boolean;
  readonly allowedProviders: readonly RuntimeProviderId[];
}

const KNOWN_PROVIDERS: readonly RuntimeProviderId[] = ["ollama", "openai"];

/**
 * `runtime.enable_cloud` / `runtime.disable_cloud` side effect (RFC-046): flip the
 * Sphere's `cloudInferenceEnabled` and (on enable) permit the requested cloud
 * providers. `enabled` is fixed by which capability bound to this handler — it is
 * NEVER read from caller input — so routing through disable can't bypass the enable
 * approval floor. Records a security fact only (decision + flag), never a secret.
 */
async function setSphereCloud(deps: RuntimeGovernanceDeps, input: RuntimeCloudInput, enabled: boolean): Promise<RuntimeCloudResult> {
  const sphereId = input.sphereId;
  if (typeof sphereId !== "string") throw new Error("input.sphereId is required");
  const snap = await deps.store.load(sphereId);
  if (snap === undefined) throw new Error(`Sphere ${sphereId} not found`);
  const imported = importSphere(snap);
  const allowProviders = (input.allowProviders ?? []).filter((p): p is RuntimeProviderId =>
    (KNOWN_PROVIDERS as readonly string[]).includes(p),
  );
  const runtimeConfig = setCloudInference(imported.runtimeConfig, { enabled, allowProviders });
  const stamp = (deps.now ?? (() => new Date().toISOString()))();
  await deps.store.save(exportSphere({ ...imported, runtimeConfig, exportedAt: stamp }));
  deps.auditSink?.record({
    type: enabled ? "runtime.cloud.enabled" : "runtime.cloud.disabled",
    sphereId,
    resourceType: "sphere",
    resourceId: sphereId,
    decision: "executed",
    reason: `cloudInferenceEnabled=${runtimeConfig.cloudInferenceEnabled}; allowedProviders=${runtimeConfig.allowedProviders.join(",")}`,
    correlationId: input.correlationId ?? `cloud-${stamp}`,
    createdAt: stamp,
  });
  return { cloudInferenceEnabled: runtimeConfig.cloudInferenceEnabled, allowedProviders: runtimeConfig.allowedProviders };
}

export function enableSphereCloud(deps: RuntimeGovernanceDeps, input: RuntimeCloudInput): Promise<RuntimeCloudResult> {
  return setSphereCloud(deps, input, true);
}

export function disableSphereCloud(deps: RuntimeGovernanceDeps, input: RuntimeCloudInput): Promise<RuntimeCloudResult> {
  return setSphereCloud(deps, input, false);
}

export interface RuntimeBackupInput {
  readonly sphereId?: string;
  readonly agentId?: string;
  readonly correlationId?: string;
}

export interface RuntimeBackupResult {
  readonly snapshotId: string;
  readonly ref: string;
  readonly createdAt: string;
}

/**
 * `runtime.session.backup` side effect: capture the agent's runtime profile dir
 * as an opaque encrypted blob and record a RuntimeStateSnapshot. Records the fact
 * only (never content). Non-destructive — no approval floor (catalog).
 */
export async function backupAgentState(deps: RuntimeGovernanceDeps, input: RuntimeBackupInput): Promise<RuntimeBackupResult> {
  if (deps.snapshots === undefined || deps.blobs === undefined || deps.newSnapshotId === undefined) {
    throw new Error("Runtime session backup is not enabled");
  }
  const { sphereId, agentId } = await loadAgent(deps, input.sphereId, input.agentId);
  const stamp = (deps.now ?? (() => new Date().toISOString()))();
  const id = deps.newSnapshotId();
  const ref = await deps.blobs.capture(id, profileDir(deps.home, agentId));
  const snapshot = createRuntimeStateSnapshot({ id, agentId, sphereId, ref, createdAt: stamp });
  await deps.snapshots.save(snapshot);
  deps.auditSink?.record({
    type: "runtime.session.backed_up",
    sphereId,
    agentId,
    resourceType: "agent",
    resourceId: agentId,
    decision: "executed",
    reason: `snapshotRef=${ref}`,
    correlationId: input.correlationId ?? `bk-${stamp}`,
    createdAt: stamp,
  });
  return { snapshotId: id, ref, createdAt: stamp };
}

export interface RuntimeRestoreInput {
  readonly sphereId?: string;
  readonly agentId?: string;
  readonly snapshotId?: string;
  readonly correlationId?: string;
}

/**
 * `runtime.session.restore` side effect: restore the agent's runtime state from a
 * snapshot, overwriting current state. Deny-by-default guard: the snapshot must be
 * available and belong to the same agent + Sphere. Approval-gated (catalog).
 */
export async function restoreAgentState(
  deps: RuntimeGovernanceDeps,
  input: RuntimeRestoreInput,
): Promise<{ readonly restored: true; readonly snapshotId: string }> {
  if (deps.snapshots === undefined || deps.blobs === undefined) {
    throw new Error("Runtime session restore is not enabled");
  }
  const { sphereId, agentId } = await loadAgent(deps, input.sphereId, input.agentId);
  if (typeof input.snapshotId !== "string") throw new Error("input.snapshotId is required");
  const snapshot = await deps.snapshots.load(input.snapshotId);
  if (snapshot === undefined) throw new Error(`Snapshot ${input.snapshotId} not found`);
  assertSnapshotRestorable(snapshot, { agentId, sphereId }); // deny by default
  await deps.blobs.restore(snapshot.ref, profileDir(deps.home, agentId));
  const stamp = (deps.now ?? (() => new Date().toISOString()))();
  deps.auditSink?.record({
    type: "runtime.session.restored",
    sphereId,
    agentId,
    resourceType: "agent",
    resourceId: agentId,
    decision: "executed",
    reason: `snapshotRef=${snapshot.ref}`,
    correlationId: input.correlationId ?? `rs-${stamp}`,
    createdAt: stamp,
  });
  return { restored: true, snapshotId: input.snapshotId };
}
