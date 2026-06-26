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

export type PackageType = "skill" | "mcp" | "bundle";

export type AgeRating = "all" | "teen" | "adult";

export interface PackageDependency {
  readonly packageId: string;
  readonly versionRange: string;
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
}

export function createManifest(input: ManifestInput): PackageManifest {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length === 0) throw new Error("Package title must not be empty");
  if (description.length === 0) throw new Error("Package description must not be empty");
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
