/**
 * Package + lifecycle (RFC-002; domain-model.md, entity-lifecycle.md).
 *
 * A Package is the unit of distribution from the store: a `skill` (agent
 * competence composing capabilities), an `mcp` (an Integration adapter), or a
 * `bundle` (dependency grouping). This module is the pure-core manifest + the
 * per-Sphere installed lifecycle.
 *
 * Key invariant (RFC-002): **install ≠ authorization.** Installing makes
 * capabilities available and creates bindings DISABLED; only policies confirmed
 * in the grant wizard authorize anyone, and the Policy Engine still evaluates
 * every call. Disabling/uninstalling blocks the future, not the past.
 *
 * Pure domain: no I/O, no provider SDK. Sandboxing, signature verification and
 * dependency resolution are install-pipeline concerns handled outside the core.
 */

import type { CapabilityBinding } from "../capability/types.js";
import { createIntegration, type Integration } from "../integration/integration.js";
import type { AgeProfile, Policy, RiskLevel } from "../policy/types.js";

export type PackageType = "skill" | "mcp" | "bundle";

export type AgeRating = "all" | "teen" | "adult";

export interface PackageDependency {
  readonly packageId: string;
  readonly versionRange: string;
}

/**
 * How a provided capability is executed (RFC-011). A **mechanism mapping only**
 * (coding principle 8): it says *how* a capability runs — which concrete tool —
 * never *who* may run it. Declaring a tool name grants nothing; authorization is
 * the Policy Engine's job.
 */
export interface PackageBinding {
  readonly capability: string;
  readonly runtime: "hermes" | "local" | "n8n" | "custom";
  readonly runtimeToolName: string;
  readonly execution: "local" | "cloud";
  readonly risk: RiskLevel;
  /** Binding-level approval floor; policy may raise it, runtime may not lower it. */
  readonly requiresApproval?: boolean;
}

/**
 * Declares that a package's capabilities are backed by a configurable external
 * integration, not in-process KinOS code (RFC-016). `provider` is the default
 * adapter family (e.g. "google", "caldav"); `providerChoices` optionally lets an
 * admin pick among services at configure time. Scopes are the access the
 * integration will request (visible to administrators). Installing such a package
 * creates a `proposed` Integration; configuring it supplies credentials by
 * reference; the capability name is unchanged whichever provider backs it.
 */
export interface PackageIntegration {
  readonly provider: string;
  readonly providerChoices?: readonly string[];
  readonly scopes?: readonly string[];
  /**
   * How the integration authorizes (RFC-017). `oauth` → connect via the auth
   * broker's consent flow (secretRef becomes a broker account reference); `apikey`
   * → a static secret reference set via integration.configure. Absent → apikey.
   */
  readonly auth?: "oauth" | "apikey";
}

/**
 * A grant the wizard proposes for a provided capability (RFC-002 `defaultPolicies`,
 * RFC-011). Presets are adult-scoped and deny-by-default for minors (invariant 8);
 * `effect` is `allow` or `require_approval`, never a silent grant. Materialized
 * into ordinary versioned Sphere policies only when an admin enables the package.
 */
export interface PolicyPreset {
  readonly description: string;
  readonly subjectSelector: Policy["subjectSelector"];
  readonly capabilityNames: readonly string[];
  readonly effect: "allow" | "require_approval";
  readonly approverRoles?: readonly string[];
}

export interface PackageManifest {
  readonly id: string;
  readonly type: PackageType;
  readonly title: string;
  /** Plain, practical: what it lets the agent do (RFC-002, contractual). */
  readonly description: string;
  readonly version: string;
  readonly publisher: string;
  readonly ageRating: AgeRating;
  readonly dependencies: readonly PackageDependency[];
  /** Capabilities an mcp/skill package registers into the catalog (deny-by-default risk). */
  readonly providesCapabilities: readonly string[];
  /** How each provided capability runs (RFC-011). Mechanism only, never authorization. */
  readonly bindings: readonly PackageBinding[];
  /** The grant the wizard proposes; inert until an admin enables the package (RFC-011). */
  readonly defaultPolicies: readonly PolicyPreset[];
  /** When set, the capabilities are backed by a configurable integration (RFC-016). */
  readonly integration?: PackageIntegration;
}

/** entity-lifecycle.md → Package lifecycle (available is store-side, pre-install). */
export type PackageStatus = "installed" | "enabled" | "disabled" | "uninstalled";

export interface InstalledPackage {
  readonly sphereId: string;
  readonly manifest: PackageManifest;
  readonly status: PackageStatus;
}

export interface ManifestInput {
  readonly id: string;
  readonly type: PackageType;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly publisher: string;
  readonly ageRating: AgeRating;
  readonly dependencies?: readonly PackageDependency[];
  readonly providesCapabilities?: readonly string[];
  readonly bindings?: readonly PackageBinding[];
  readonly defaultPolicies?: readonly PolicyPreset[];
  readonly integration?: PackageIntegration;
}

export function createManifest(input: ManifestInput): PackageManifest {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length === 0) throw new Error("Package title must not be empty");
  if (description.length === 0) throw new Error("Package description must not be empty");
  // A binding must implement a capability the package actually provides — a stray
  // binding would map a tool to a capability nothing declared (deny-by-default keeps
  // it harmless, but reject it so manifests stay honest).
  const provided = new Set(input.providesCapabilities ?? []);
  for (const b of input.bindings ?? []) {
    if (!provided.has(b.capability)) {
      throw new Error(`Package binding for '${b.capability}' is not in providesCapabilities`);
    }
  }
  return {
    id: input.id,
    type: input.type,
    title,
    description,
    version: input.version,
    publisher: input.publisher,
    ageRating: input.ageRating,
    dependencies: input.dependencies ? [...input.dependencies] : [],
    providesCapabilities: input.providesCapabilities ? [...input.providesCapabilities] : [],
    bindings: input.bindings ? [...input.bindings] : [],
    defaultPolicies: input.defaultPolicies ? [...input.defaultPolicies] : [],
    ...(input.integration !== undefined ? { integration: input.integration } : {}),
  };
}

/**
 * Install a package into a Sphere. Status `installed` — capabilities are now
 * available but bindings start disabled; use is NOT granted until the wizard's
 * policies are confirmed (which moves it to `enabled`). Install never authorizes.
 */
export function installPackage(manifest: PackageManifest, sphereId: string): InstalledPackage {
  return { sphereId, manifest, status: "installed" };
}

/** Enable: the confirmed grant-wizard policies activate and bindings are enabled. */
export function enablePackage(pkg: InstalledPackage): InstalledPackage {
  if (pkg.status === "uninstalled") throw new Error("An uninstalled package cannot be enabled");
  return { ...pkg, status: "enabled" };
}

/** Disable: blocks future use; bindings disabled; audit history retained. */
export function disablePackage(pkg: InstalledPackage): InstalledPackage {
  if (pkg.status === "uninstalled") throw new Error("An uninstalled package cannot be disabled");
  return { ...pkg, status: "disabled" };
}

/** Uninstall: bindings + sandbox removed; audit facts retained (blocks the future). */
export function uninstallPackage(pkg: InstalledPackage): InstalledPackage {
  return { ...pkg, status: "uninstalled" };
}

export function isUsable(pkg: InstalledPackage): boolean {
  return pkg.status === "enabled";
}

/**
 * Materialize a manifest's bindings as CapabilityBindings at a given status
 * (RFC-011). Install uses `disabled` (available but deny-by-default until an admin
 * enables); enable uses `enabled`. Pure and deterministic — keyed by capability,
 * so re-running is idempotent. A binding is mechanism only; it authorizes nothing.
 */
export function packageBindings(
  manifest: PackageManifest,
  status: "disabled" | "enabled",
): CapabilityBinding[] {
  return manifest.bindings.map((b) => ({
    capability: b.capability,
    runtime: b.runtime,
    runtimeToolName: b.runtimeToolName,
    execution: b.execution,
    risk: b.risk,
    requiresApproval: b.requiresApproval ?? false,
    status,
  }));
}

/**
 * Materialize a manifest's `defaultPolicies` presets into concrete active Sphere
 * policies for the grant wizard (RFC-011). Stable ids keyed by package + index so
 * a re-enable is idempotent (the caller skips ids it already has). These are
 * ordinary versioned, editable policies — a grant, not a hidden privilege; the
 * Policy Engine still evaluates every call.
 */
export function packageGrantPolicies(manifest: PackageManifest, sphereId: string): Policy[] {
  return manifest.defaultPolicies.map((preset, i) => ({
    id: `pol_${sphereId}_pkg_${manifest.id}_${i}`,
    sphereId,
    description: preset.description,
    subjectSelector: preset.subjectSelector,
    action: "execute" as const,
    resourceSelector: { capabilityNames: [...preset.capabilityNames] },
    effect: preset.effect,
    ...(preset.approverRoles !== undefined ? { approverRoles: [...preset.approverRoles] } : {}),
    priority: 10,
    version: 1,
    status: "active" as const,
  }));
}

/**
 * Synthesize Capability Bindings for an integration package's provided
 * capabilities (RFC-016 inc.2). Each binding is `runtime: "custom"` and names the
 * Sphere Integration by id in `runtimeToolName` — the integration executor
 * resolves the configured provider from it. Risk comes from the catalog via
 * `riskFor`. Bindings are mechanism only; the grant policies authorize.
 */
export function packageIntegrationBindings(
  manifest: PackageManifest,
  integrationId: string,
  status: "disabled" | "enabled",
  riskFor: (capability: string) => RiskLevel,
): CapabilityBinding[] {
  if (manifest.integration === undefined) return [];
  return manifest.providesCapabilities.map((capability) => ({
    capability,
    runtime: "custom",
    runtimeToolName: integrationId,
    execution: "local",
    risk: riskFor(capability),
    requiresApproval: false,
    status,
  }));
}

/**
 * Materialize an integration package's declared integration into a `proposed`
 * Sphere Integration (RFC-016), reusing `createIntegration`. Provider and provided
 * capabilities come from the manifest; no secret yet (configured later, by
 * reference). Returns undefined for a non-integration package.
 */
export function packageIntegration(manifest: PackageManifest, sphereId: string, id: string): Integration | undefined {
  if (manifest.integration === undefined) return undefined;
  return createIntegration({
    id,
    sphereId,
    provider: manifest.integration.provider,
    ...(manifest.integration.providerChoices !== undefined ? { providerChoices: [...manifest.integration.providerChoices] } : {}),
    ...(manifest.integration.scopes !== undefined ? { scopes: [...manifest.integration.scopes] } : {}),
    providesCapabilities: [...manifest.providesCapabilities],
    ...(manifest.integration.auth !== undefined ? { auth: manifest.integration.auth } : {}),
  });
}

/**
 * An admin-specified grant clause (RFC-014): who gets which of the package's
 * capabilities. `capabilities` MUST be a subset of what the package provides — a
 * package can never be used to grant a capability it does not implement.
 */
export interface GrantClause {
  readonly roles?: readonly string[];
  readonly memberIds?: readonly string[];
  readonly ageProfiles?: readonly AgeProfile[];
  readonly capabilities: readonly string[];
  readonly effect?: "allow" | "require_approval";
  readonly approverRoles?: readonly string[];
}

/**
 * Materialize an admin's grant clauses into ordinary active Sphere policies
 * (RFC-014). Bounded by the manifest: a clause naming a capability the package
 * does not provide is rejected. Minor safety is NOT re-checked here — the catalog
 * profile floor denies a risky capability for a minor per call regardless, so an
 * over-broad clause is inert rather than dangerous (defence in depth). A clause
 * with an empty subject selector or no capabilities is rejected (nothing to grant,
 * or a grant to everyone — deny-by-default forbids the silent broad grant).
 */
export function customGrantPolicies(
  manifest: PackageManifest,
  sphereId: string,
  clauses: readonly GrantClause[],
): Policy[] {
  const provided = new Set(manifest.providesCapabilities);
  return clauses.map((clause, i) => {
    if (clause.capabilities.length === 0) {
      throw new Error("A grant clause must name at least one capability");
    }
    for (const cap of clause.capabilities) {
      if (!provided.has(cap)) {
        throw new Error(`Package '${manifest.id}' does not provide capability '${cap}'`);
      }
    }
    const hasSelector =
      (clause.roles?.length ?? 0) > 0 || (clause.memberIds?.length ?? 0) > 0 || (clause.ageProfiles?.length ?? 0) > 0;
    if (!hasSelector) {
      throw new Error("A grant clause must select at least one role, member, or age profile");
    }
    const effect = clause.effect ?? "allow";
    if (effect === "require_approval" && (clause.approverRoles?.length ?? 0) === 0) {
      throw new Error("An approval grant clause requires at least one approver role");
    }
    return {
      id: `pol_${sphereId}_pkg_${manifest.id}_grant_${i}`,
      sphereId,
      description: `Package '${manifest.id}' grant (admin-scoped).`,
      subjectSelector: {
        ...(clause.roles !== undefined ? { roles: [...clause.roles] } : {}),
        ...(clause.memberIds !== undefined ? { memberIds: [...clause.memberIds] } : {}),
        ...(clause.ageProfiles !== undefined ? { ageProfiles: [...clause.ageProfiles] } : {}),
      },
      action: "execute" as const,
      resourceSelector: { capabilityNames: [...clause.capabilities] },
      effect,
      ...(clause.approverRoles !== undefined ? { approverRoles: [...clause.approverRoles] } : {}),
      priority: 10,
      version: 1,
      status: "active" as const,
    };
  });
}
