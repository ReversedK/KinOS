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
  createManifest({
    id: "family-notes",
    type: "skill",
    title: "Family Notes",
    description: "Lets your agent search the family's shared notes and share a note with a member.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["memory.search", "memory.share"],
    bindings: [
      { capability: "memory.search", runtime: "local", runtimeToolName: "local.memory_search", execution: "local", risk: "low" },
      { capability: "memory.share", runtime: "local", runtimeToolName: "local.memory_share", execution: "local", risk: "high" },
    ],
    defaultPolicies: [
      {
        description: "Adults may search the family notes (Family Notes package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["memory.search"],
        effect: "allow",
      },
      {
        description: "Adults may share a note, subject to approval (Family Notes package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["memory.share"],
        effect: "require_approval",
        approverRoles: ["parent"],
      },
    ],
  }),
  createManifest({
    id: "household-messaging",
    type: "skill",
    title: "Household Messaging",
    description: "Lets your agent draft and send an external message on the household's behalf, subject to approval.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "teen",
    providesCapabilities: ["message.send"],
    bindings: [
      { capability: "message.send", runtime: "local", runtimeToolName: "local.message", execution: "local", risk: "high" },
    ],
    defaultPolicies: [
      {
        description: "Adults may send an external message, subject to approval (Household Messaging package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["message.send"],
        effect: "require_approval",
        approverRoles: ["parent"],
      },
    ],
  }),
  createManifest({
    id: "household-payments",
    type: "skill",
    title: "Household Payments",
    description: "Lets your agent execute a household payment. Always requires approval; adults only.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["payment.execute"],
    bindings: [
      { capability: "payment.execute", runtime: "local", runtimeToolName: "local.pay", execution: "local", risk: "critical" },
    ],
    // Even an `allow` grant is raised to approval by the catalog's critical
    // approval floor on payment.execute — a demonstration that the floor wins.
    defaultPolicies: [
      {
        description: "Adults may execute a household payment (Household Payments package). The critical approval floor still applies per call.",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["payment.execute"],
        effect: "allow",
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
