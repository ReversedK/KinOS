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
