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
    // Memory SHARING only. Capturing and searching an agent's own memory is now
    // built-in and on by default (RFC-043), so this package no longer offers them —
    // it exists solely to let an adult share a specific note with another member and
    // revoke that share. The write (share) is approval-gated; revoking is direct.
    id: "memory-sharing",
    type: "skill",
    title: "Memory sharing",
    description: "Lets your agent share a specific note with another member, and revoke that share.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["memory.share", "memory.revoke_share"],
    bindings: [
      { capability: "memory.share", runtime: "local", runtimeToolName: "local.memory_share", execution: "local", risk: "high" },
      { capability: "memory.revoke_share", runtime: "local", runtimeToolName: "local.memory_revoke", execution: "local", risk: "medium" },
    ],
    defaultPolicies: [
      {
        description: "Adults may revoke a shared note (Memory sharing package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["memory.revoke_share"],
        effect: "allow",
      },
      {
        description: "Adults may share a note, subject to approval (Memory sharing package).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["memory.share"],
        effect: "require_approval",
        approverRoles: ["admin", "parent"],
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
    // RFC-031/048: a real Documents SOURCE (integration). Provider choice selects
    // where documents come from — "local" (the Sphere's shared notes, read-only),
    // "minio" (a MinIO/S3 object store the Sphere owns — WRITABLE, per RFC-048), or
    // "google_drive" (a real Drive over OAuth). Installing mints a proposed Integration;
    // configuring picks the provider + connects; enabling backs document.* via the chosen
    // source. Capability, policies and audit are identical whichever provider backs them.
    // This is the single Documents package (it subsumes the former "family-documents" skill).
    id: "documents",
    type: "mcp",
    title: "Documents",
    description: "Connect a documents source (KinOS-local, a MinIO/S3 store you own, or Google Drive) so your agent can search, summarize — and, on a store you own, upload documents.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    providesCapabilities: ["document.search", "document.summarize", "document.upload"],
    integration: {
      provider: "google_drive",
      providerChoices: ["local", "minio", "google_drive"],
      scopes: ["documents.read", "documents.write"],
      auth: "oauth",
    },
    // Reads: adults by preset, read-only (invariant 8), widenable to minors by a custom
    // grant. Upload is a WRITE — adults only by preset; the "local"/"google_drive"
    // providers refuse it, only "minio" implements it.
    defaultPolicies: [
      {
        description: "Adults may search and summarize the connected documents (Documents integration).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["document.search", "document.summarize"],
        effect: "allow",
      },
      {
        description: "Adults may upload documents to a writable source (Documents integration, RFC-048).",
        subjectSelector: { ageProfiles: ["adult"] },
        capabilityNames: ["document.upload"],
        effect: "allow",
      },
    ],
  }),
  createManifest({
    // RFC-016: the single Calendar integration package — the calendar functionality
    // comes from an external service configured by the admin, not from KinOS code.
    // Provider choice covers "local" (KinOS's built-in reference calendar, no external
    // service), Google/Apple (OAuth) and CalDAV (app-specific password), so this one
    // package subsumes the former "family-calendar" skill and "caldav-calendar" package.
    // Installing creates a proposed Integration; configuring supplies the provider
    // choice and credentials (by reference); enabling backs calendar.* via that service.
    id: "google-calendar",
    type: "mcp",
    title: "Calendar",
    description: "Connect a calendar (KinOS-local, Google, Apple, or CalDAV) so your agent reads and proposes events on it.",
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
        approverRoles: ["admin", "parent"],
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
