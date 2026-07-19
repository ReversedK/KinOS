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
    providesCapabilities: ["memory.capture", "memory.search", "memory.share", "memory.revoke_share"],
    bindings: [
      { capability: "memory.capture", runtime: "local", runtimeToolName: "local.memory_capture", execution: "local", risk: "low" },
      { capability: "memory.search", runtime: "local", runtimeToolName: "local.memory_search", execution: "local", risk: "low" },
      { capability: "memory.share", runtime: "local", runtimeToolName: "local.memory_share", execution: "local", risk: "high" },
      { capability: "memory.revoke_share", runtime: "local", runtimeToolName: "local.memory_revoke", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may capture, search, and revoke shares of the family notes (Family Notes package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["memory.capture", "memory.search", "memory.revoke_share"],
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
    // RFC-029: the WRITE side of shared Sphere content. Create shared notes
    // (Sphere-visible canonical memory) and lightweight projects.
    id: "shared-workspace",
    type: "skill",
    title: "Shared Notes & Projects",
    description: "Lets your agent write shared notes for the whole Sphere and create shared projects.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["sphere.note.create", "sphere.project.create"],
    bindings: [
      { capability: "sphere.note.create", runtime: "local", runtimeToolName: "local.sphere_note_create", execution: "local", risk: "medium" },
      { capability: "sphere.project.create", runtime: "local", runtimeToolName: "local.sphere_project_create", execution: "local", risk: "medium" },
    ],
    // Deny-by-default for minors (invariant 8): the preset grants adults only.
    // The capability floor still PERMITS teens, so an admin may widen to them with
    // a custom grant at enable time — never by default.
    defaultPolicies: [
      {
        description: "Adults may create shared notes and projects (Shared Notes & Projects package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["sphere.note.create", "sphere.project.create"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-029: the READ side. Search and summarize the Sphere's shared documents
    // (its shared_with_sphere content). Read-only, open to all profiles — a
    // child's agent may read the family's shared documents, never a private item.
    id: "family-documents",
    type: "skill",
    title: "Documents",
    description: "Lets your agent search and summarize the Sphere's shared documents. Read-only.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["document.search", "document.summarize"],
    bindings: [
      { capability: "document.search", runtime: "local", runtimeToolName: "local.document_search", execution: "local", risk: "low" },
      { capability: "document.summarize", runtime: "local", runtimeToolName: "local.document_summarize", execution: "local", risk: "low" },
    ],
    // Deny-by-default for minors (invariant 8): the preset grants adults only,
    // even though these are read-only and the capability floor permits children.
    // An admin widens to teens/children with a custom grant at enable time.
    defaultPolicies: [
      {
        description: "Adults may search and summarize the Sphere's shared documents (Documents package, read-only).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["document.search", "document.summarize"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-031: a real Documents SOURCE (integration), the external counterpart to
    // the family-documents skill. Provider choice selects where documents come
    // from — "local" (the Sphere's shared notes) or "google_drive" (a real Drive
    // over OAuth). Installing mints a proposed Integration; configuring picks the
    // provider + connects; enabling backs document.* via the chosen source. The
    // capability, policies and audit are identical whichever provider backs them.
    id: "documents",
    type: "mcp",
    title: "Documents",
    description: "Connect a real documents source (Google Drive, or KinOS's own shared notes) so your agent can search and summarize them.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["document.search", "document.summarize"],
    integration: {
      provider: "google_drive",
      providerChoices: ["local", "google_drive"],
      scopes: ["documents.read"],
      auth: "oauth",
    },
    // Adults only by default (invariant 8); read-only. Widen to minors via a custom
    // grant at enable time (the capability floor permits it — read-only).
    defaultPolicies: [
      {
        description: "Adults may search and summarize the connected documents (Documents integration, read-only).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["document.search", "document.summarize"],
        effect: "allow",
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
    // RFC-016: an integration package — the calendar functionality comes from an
    // external service configured by the admin, not from KinOS code. Installing it
    // creates a proposed Integration; configuring it supplies the provider choice
    // and credentials (by reference); enabling it backs calendar.* via that service.
    id: "google-calendar",
    type: "mcp",
    title: "Google Calendar",
    description: "Connect a real calendar service (Google, CalDAV, or Apple) so your agent reads and proposes events on it.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["calendar.read", "calendar.create_event"],
    integration: {
      provider: "google",
      // "local" uses KinOS's built-in reference calendar (no external service);
      // google/apple connect via OAuth (RFC-017); caldav uses an api-key reference.
      providerChoices: ["local", "google", "caldav", "apple"],
      scopes: ["calendar.read", "calendar.events.write"],
      auth: "oauth",
    },
    defaultPolicies: [
      {
        description: "Adults may read the connected calendar (Google Calendar integration).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.read"],
        effect: "allow",
      },
      {
        description: "Adults may propose events on the connected calendar, subject to approval.",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.create_event"],
        effect: "require_approval",
        approverRoles: ["parent"],
      },
    ],
  }),
  createManifest({
    // RFC-019: the first non-OAuth integration package. A CalDAV calendar (Apple
    // iCloud, Nextcloud, Fastmail) authenticates with an app-specific password held
    // by reference in the secret store — no OAuth broker. Installing creates a
    // proposed Integration; configuring supplies the credentials reference; enabling
    // backs calendar.* via CalDAV.
    id: "caldav-calendar",
    type: "mcp",
    title: "CalDAV Calendar (Apple / self-hosted)",
    description: "Connect an Apple iCloud, Nextcloud or Fastmail calendar over CalDAV using an app-specific password.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["calendar.read", "calendar.create_event"],
    integration: {
      provider: "caldav",
      providerChoices: ["caldav", "apple"],
      scopes: ["calendar.read", "calendar.events.write"],
      auth: "apikey",
    },
    defaultPolicies: [
      {
        description: "Adults may read the connected CalDAV calendar (CalDAV Calendar integration).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.read"],
        effect: "allow",
      },
      {
        description: "Adults may propose events on the connected CalDAV calendar, subject to approval.",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["calendar.create_event"],
        effect: "require_approval",
        approverRoles: ["parent"],
      },
    ],
  }),
  createManifest({
    // RFC-025: govern one of the Harness's OWN native toolsets. Installing grants
    // `native.web` — projected into the Harness's enabled_toolsets, a channel
    // distinct from the Sphere MCP. KinOS does not re-implement web search (the
    // Harness has it); it governs whether this agent may use it. Read-only, adults.
    id: "hermes-web",
    type: "skill",
    title: "Web Search (Harness)",
    description: "Let your agent search and read the web using the Harness's built-in tools. Read-only; adults only.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["native.web"],
    bindings: [
      { capability: "native.web", runtime: "hermes", runtimeToolName: "web", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may use the Harness's native web search (Web Search package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["native.web"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-025: grant the Harness's native cron. Actions a scheduled job triggers
    // still run as policy-checked capability calls through the Sphere MCP (RFC-007),
    // so scheduling itself is safe to grant.
    id: "hermes-automation",
    type: "skill",
    title: "Automation / Cron (Harness)",
    description: "Let your agent schedule recurring tasks with the Harness's native cron. Triggered actions stay policy-checked.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["native.cron"],
    bindings: [
      { capability: "native.cron", runtime: "hermes", runtimeToolName: "cron", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may schedule Harness cron jobs (Automation package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["native.cron"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-025: grant the Harness's native media tools (vision, image gen, TTS).
    id: "hermes-media",
    type: "skill",
    title: "Media (Harness)",
    description: "Let your agent use the Harness's native media tools: image understanding, image generation, and text-to-speech.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["native.media"],
    bindings: [
      { capability: "native.media", runtime: "hermes", runtimeToolName: "media", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may use the Harness's native media tools (Media package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["native.media"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-025: grant the Harness's native browser. It ACTS on the web, so the
    // capability carries an approval floor — even this allow is raised to
    // require_approval per use.
    id: "hermes-browser",
    type: "skill",
    title: "Browser (Harness)",
    description: "Let your agent drive the Harness's native browser to act on the web. Adults only; each use requires approval.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["native.browser"],
    bindings: [
      { capability: "native.browser", runtime: "hermes", runtimeToolName: "browser", execution: "local", risk: "high" },
    ],
    defaultPolicies: [
      {
        description: "Adults may drive the Harness's native browser, subject to approval (Browser package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["native.browser"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-030: govern the Harness's native delegation. Grants `native.delegate`
    // — the agent may spawn focused subagents. Safe because a subagent's toolsets
    // are a subset of the parent's governed set and its capability calls flow
    // through the parent's Sphere MCP (policy- and scope-checked per call).
    id: "hermes-delegation",
    type: "skill",
    title: "Delegation / Subagents (Harness)",
    description: "Let your agent spawn focused subagents to work in parallel. Subagents stay bounded by the agent's governed surface.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "adult",
    providesCapabilities: ["native.delegate"],
    bindings: [
      { capability: "native.delegate", runtime: "hermes", runtimeToolName: "delegation", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may spawn Harness subagents (Delegation package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["native.delegate"],
        effect: "allow",
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
