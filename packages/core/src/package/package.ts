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
import type { Policy, RiskLevel } from "../policy/types.js";

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
