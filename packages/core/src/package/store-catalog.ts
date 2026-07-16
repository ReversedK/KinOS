/**
 * Curated store catalog (RFC-002, MVP).
 *
 * The MVP store is curated: a fixed set of reviewed, signed packages offered for
 * install. This module is the pure-core list of `available` package manifests the
 * UI browses (`store.browse`). Signature verification, dependency resolution and
 * sandboxing happen in the install pipeline outside the core; this is metadata.
 */

import { createManifest, type PackageManifest } from "./package.js";

const CATALOG: readonly PackageManifest[] = [
  createManifest({
    id: "minecraft-mcp",
    type: "mcp",
    title: "Minecraft (MCP)",
    description: "Connects your agent to a Minecraft world so it can build and inspect structures.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["minecraft.build_structure"],
  }),
  createManifest({
    id: "minecraft-themepark",
    type: "skill",
    title: "Minecraft Theme Park",
    description: "Lets your agent build a themed amusement park in Minecraft.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    dependencies: [{ packageId: "minecraft-mcp", versionRange: "^1" }],
  }),
  createManifest({
    id: "family-calendar",
    type: "skill",
    title: "Family Calendar",
    description: "Lets your agent read the family calendar and propose events for approval.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["calendar.read", "calendar.create_event"],
    // How each capability runs (RFC-011): mechanism only, authorizes nothing. The
    // MVP maps to local executor handlers; a real calendar integration replaces
    // these later without touching policy.
    bindings: [
      { capability: "calendar.read", runtime: "local", runtimeToolName: "local.calendar_read", execution: "local", risk: "low" },
      { capability: "calendar.create_event", runtime: "local", runtimeToolName: "local.calendar", execution: "local", risk: "medium" },
    ],
    // The grant the wizard proposes: adults may read; creating an event proposes it
    // for approval (require_approval). Minors are denied by default (no preset, and
    // the catalog profile floor denies them regardless).
    defaultPolicies: [
      {
        description: "Adults may read the family calendar (Family Calendar package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.read"],
        effect: "allow",
      },
      {
        description: "Adults may propose calendar events for approval (Family Calendar package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.create_event"],
        effect: "require_approval",
        approverRoles: ["parent"],
      },
    ],
  }),
];

/** The curated list of installable packages (a fresh copy each call). */
export function defaultStoreCatalog(): readonly PackageManifest[] {
  return CATALOG.map((m) => ({ ...m }));
}

/** Look up one store package by id. */
export function findStorePackage(id: string): PackageManifest | undefined {
  const found = CATALOG.find((m) => m.id === id);
  return found === undefined ? undefined : { ...found };
}
