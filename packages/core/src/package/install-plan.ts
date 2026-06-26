/**
 * Package dependency resolution (RFC-002 acceptance: "installing a package
 * resolves and dedups dependencies and installs an absent mcp dependency").
 *
 * Pure planning over the curated catalog: given a root package id, the catalog,
 * and the ids already installed in the Sphere, return the ordered list of
 * manifests to install — dependencies first, each appearing once, and any already
 * present (at a satisfying version) reused, not reinstalled. Fails closed: an
 * unknown package or a dependency cycle throws rather than guessing.
 *
 * Version-range satisfaction is intentionally minimal for the MVP (presence by id
 * = satisfied); real semver range checking is a later refinement. No I/O.
 */

import type { PackageManifest } from "./package.js";

export function resolveInstallPlan(
  rootId: string,
  catalog: readonly PackageManifest[],
  installedIds: readonly string[],
): readonly PackageManifest[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const installed = new Set(installedIds);
  const plan: PackageManifest[] = [];
  const planned = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (installed.has(id) || planned.has(id)) return; // dedup: reused, not reinstalled
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle detected at package '${id}'`);
    }
    const manifest = byId.get(id);
    if (manifest === undefined) {
      throw new Error(`Package '${id}' not found in the store catalog`);
    }
    visiting.add(id);
    for (const dep of manifest.dependencies) {
      visit(dep.packageId);
    }
    visiting.delete(id);
    planned.add(id);
    plan.push(manifest); // post-order: dependencies precede dependents
  };

  visit(rootId);
  return plan;
}
