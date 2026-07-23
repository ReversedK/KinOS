/**
 * Capability catalog (capability-catalog.md). Declares defaults and floors; it
 * never widens access — the Policy Engine still gates each call and deny/
 * require_approval from policy dominates a catalog default.
 *
 * This is a minimal MVP subset. An unknown name is always denied (handled by
 * the resolver), for any profile.
 */

import type { Capability } from "./types.js";

const CAPABILITIES: readonly Capability[] = [
  {
    name: "memory.search",
    description: "Search authorized memory.",
    risk: "low",
    allowedProfiles: ["adult", "teen", "child"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "memory.share",
    description: "Share a memory item with a member or Sphere.",
    risk: "high",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceClass", "decision", "correlationId"],
  },
  {
    // RFC-013: record a note into canonical memory. Private by default (ADR-002);
    // a scope is never widened by silence. Audit records the fact, never content.
    name: "memory.capture",
    description: "Record a note into canonical memory (private by default).",
    risk: "low",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-015: withdraw a member's share of a note. Revocation blocks the future,
    // not the past (invariant 5) — the grant record is retained as an audit fact.
    // Low-friction safety action (no approval floor); owner-only at the handler.
    name: "memory.revoke_share",
    description: "Withdraw a member's share of a note (revocation blocks the future, not the past).",
    risk: "medium",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-029: create a SHARED Sphere note. A shared note is a memory item owned
    // by the Sphere with `shared_with_sphere` visibility — this is the explicit,
    // audited "make it shared" write (private-by-default is never widened by
    // silence, ADR-002). Adults/teens only; a child is read-only by default.
    name: "sphere.note.create",
    description: "Create a shared Sphere note (visible to the whole Sphere).",
    risk: "medium",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-029: create a shared project in the Sphere. A lightweight collaborative
    // entity (title + description), distinct from a note.
    name: "sphere.project.create",
    description: "Create a shared project in the Sphere.",
    risk: "medium",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-029: read-only search across the Sphere's SHARED documents (its
    // shared_with_sphere content). Never a member's private memory — that is
    // memory.search. Open to children by default: a supervised child's agent may
    // read the family's shared documents.
    name: "document.search",
    description: "Search the Sphere's shared documents (read-only).",
    risk: "low",
    allowedProfiles: ["adult", "teen", "child"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-029: summarize one shared document by id. Read-only; a deterministic
    // extractive summary (MVP) — never a private item.
    name: "document.summarize",
    description: "Summarize one of the Sphere's shared documents (read-only).",
    risk: "low",
    allowedProfiles: ["adult", "teen", "child"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    name: "calendar.read",
    description: "Read authorized calendars.",
    risk: "low",
    allowedProfiles: ["adult", "teen", "child"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "calendar.create_event",
    description: "Create a calendar event.",
    risk: "medium",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "message.send",
    description: "Send an external message.",
    risk: "high",
    allowedProfiles: ["adult", "teen"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "destinationClass", "decision", "correlationId"],
  },
  {
    name: "payment.execute",
    description: "Execute a payment.",
    risk: "critical",
    allowedProfiles: ["adult"],
    approvalFloor: true,
    auditFacts: ["actor", "capability", "riskLevel", "decision", "correlationId"],
  },
  {
    // RFC-021: the full-fidelity Sphere snapshot for backup/restore (results-contract
    // §17/§19). It contains every member's memory, private items included — a backup
    // that drops them cannot restore the Sphere. The approval floor plus the core's
    // no-self-approval rule mean a lone adult can never unilaterally export another
    // member's private memory; a minor cannot export at all. This is a local backup,
    // never an external transfer (see RFC-021 §Security).
    name: "sphere.export",
    description: "Export the Sphere as a complete snapshot for backup and restore.",
    risk: "critical",
    allowedProfiles: ["adult"],
    approvalFloor: true,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-022: recreate a Sphere from an export snapshot. No approval floor —
    // deliberately, and unlike sphere.export: at restore time the Sphere does not
    // exist on this instance, so neither do its members, and an approval could
    // never be resolved by anyone. It is bootstrap-trusted like sphere.create (the
    // adult local operator is the root of trust for an empty instance) and grants
    // no more: restore never overwrites an existing Sphere, and the restored
    // Sphere keeps its own administrators and policies, so importing a Sphere does
    // not make the importer its admin.
    name: "sphere.restore",
    description: "Restore a Sphere from an export snapshot (never overwrites an existing Sphere).",
    risk: "critical",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-024: retire a Sphere from view (or restore it). Soft and reversible — a
    // status flip that destroys no data or audit — so no approval floor, unlike
    // export/restore. Admin-only via the admin-settings seed; deny-by-default else.
    name: "sphere.archive",
    description: "Archive a Sphere (or restore it to active). Reversible; hides it from the list.",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "runtime.set_provider",
    description: "Change the Sphere's inference provider/model (admin settings).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-004/RFC-009: set an agent's default model within the Sphere-allowed
    // set. Admin/owner-only (the founder is an administrator) and adult-only.
    // Local and immediate — an override only swaps the model string on the
    // Sphere's provider, so it never selects a provider or crosses to cloud
    // (that stays governed by runtime.set_provider). The swap is "boring".
    name: "model.set",
    description: "Set an agent's default model within the Sphere-allowed set (admin/owner).",
    risk: "medium",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "model", "decision", "correlationId"],
  },
  {
    name: "integration.enable",
    description: "Enable a connector/integration for the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "integration.disable",
    description: "Disable a connector/integration for the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-016: configure a Sphere integration — choose the external provider, set
    // the credentials secret *reference* (never the value), and the requested
    // scopes. Governed settings write; admin-only. Credentials live in the secret
    // store; the entity, audit and export hold only a reference.
    name: "integration.configure",
    description: "Configure an integration: provider, credentials (by reference), and scopes (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-017: begin connecting an OAuth integration — mints a CSRF state and
    // returns the provider's authorize URL. Consent is completed at the callback,
    // which sets the integration's secretRef to a broker account reference (never
    // a token). Admin-only; an external-transfer/consent event.
    name: "integration.oauth.begin",
    description: "Begin connecting an OAuth integration (returns the provider authorize URL) (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    name: "store.browse",
    description: "Browse the curated package store.",
    risk: "low",
    allowedProfiles: ["adult", "teen", "child"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "package.install",
    description: "Install a package from the store into the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "package.enable",
    description: "Enable an installed package for the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "package.disable",
    description: "Disable an installed package for the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-007: (re)project an agent's runtime governance config from Sphere config.
    // The runtime never edits its own config; this rewrites it. Approval-gated.
    name: "runtime.config.project",
    description: "Project an agent's runtime configuration from Sphere config (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: true,
    auditFacts: ["actor", "capability", "projectionVersion", "decision", "correlationId"],
  },
  {
    // RFC-007: back up an agent's opaque runtime working state. Non-destructive,
    // governed/audited — records the fact only, never session content.
    name: "runtime.session.backup",
    description: "Back up an agent's runtime working state as an opaque snapshot (admin/owner).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "snapshotRef", "decision", "correlationId"],
  },
  {
    // RFC-007: restore runtime working state from a snapshot, overwriting current
    // state. Destructive → approval floor.
    name: "runtime.session.restore",
    description: "Restore an agent's runtime working state from a snapshot (admin/owner).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: true,
    auditFacts: ["actor", "capability", "snapshotRef", "decision", "correlationId"],
  },
  {
    // ADR-008 §6: attach an interactive terminal to an agent's governed Harness
    // profile — the real-condition test path that replaces direct inference.
    // Interactive and high-risk: the session runs as the agent, so it reaches
    // exactly the agent's policy-authorized surface through the Sphere MCP (each
    // call re-checked there) and nothing more. Attaching is not authorizing.
    name: "runtime.session.attach",
    description: "Attach an interactive terminal to an agent's governed Harness profile (admin/owner).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-008: create a Sphere. Instance-scoped (bootstrap) — evaluated against
    // the bootstrap policy set, not a Sphere's policies. The founder becomes the
    // first administrator; a default admin policy set is seeded on creation.
    name: "sphere.create",
    description: "Create a Sphere; the founder becomes its first administrator (admin/bootstrap).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-008: add a member (role + identity) to a Sphere. In-Sphere admin.
    name: "member.invite",
    description: "Add a member (role + identity) to the Sphere (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-008: deploy an agent with a capability scope. The scope is a request
    // surface only — every capability the agent later requests is still
    // policy-checked per call (deploying is never authorizing).
    name: "agent.create",
    description: "Deploy an agent for a member with a capability scope (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    // RFC-008: change an agent's capability scope / model tag / lifecycle state.
    // Model swaps are "boring" (no identity/memory change — coding principle 9).
    name: "agent.update_config",
    description: "Update an agent's capability scope, model tag or state (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "resourceId", "decision", "correlationId"],
  },
  {
    name: "policy.manage",
    description: "Create, update, activate, or disable a Sphere policy (admin).",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "policyId", "decision", "correlationId"],
  },

  // --- Governed Hermes native toolsets (RFC-025) ---------------------------
  // A `native.<toolset>` grant does NOT run through the Sphere MCP: it is
  // projected into the Harness's `enabled_toolsets` so the agent may use that
  // native toolset directly. Governed like any capability (deny-by-default,
  // profile floor, approval), but a distinct channel. The dangerous toolsets
  // (terminal/file/execute_code) and native memory are never offered here — they
  // are a hard floor in the projection, always disabled.
  {
    name: "native.web",
    description: "Let the agent use the Harness's native web search & extract (read-only).",
    risk: "medium",
    allowedProfiles: ["adult"], // minors get no native web
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "native.cron",
    description: "Let the agent schedule Harness cron jobs. Actions they trigger are still policy-checked.",
    risk: "medium",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "native.media",
    description: "Let the agent use the Harness's native media tools (vision, image generation, TTS).",
    risk: "medium",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    name: "native.browser",
    description: "Let the agent drive the Harness's native browser. It acts on the web — approval-floored.",
    risk: "high",
    allowedProfiles: ["adult"],
    approvalFloor: true,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
  {
    // RFC-030: let the agent spawn focused subagents (the Harness's native
    // delegation). Safe to grant like native.cron: a subagent's toolsets are a
    // SUBSET of the parent's governed set and its capability calls still go
    // through the parent's Sphere MCP (policy- and scope-checked per call), so it
    // can never exceed the parent's authority. No approval floor — the governed
    // edge is each action the subagent takes, already gated by its own capability.
    name: "native.delegate",
    description: "Let the agent spawn focused subagents (Harness delegation). Subagents stay bounded by the agent's governed surface.",
    risk: "medium",
    allowedProfiles: ["adult"],
    approvalFloor: false,
    auditFacts: ["actor", "capability", "decision", "correlationId"],
  },
];

/**
 * Per-capability input JSON Schema (capability-catalog.md). Surfaced to the runtime
 * as each tool's `inputSchema` so an agent knows the exact arguments — a required id,
 * a query — instead of guessing (which made e.g. document.summarize fail repeatedly).
 * A capability with no entry advertises a permissive object schema.
 */
const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required?: readonly string[]) => ({
  type: "object",
  properties,
  ...(required !== undefined && required.length > 0 ? { required } : {}),
});

const CAPABILITY_INPUT_SCHEMAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "memory.search": obj({ query: str("Text to match; omit to return all readable memory.") }),
  "memory.capture": obj({ content: str("The note text to record (private by default)."), summary: str("Optional short summary.") }, ["content"]),
  "memory.share": obj({ itemId: str("Id of the memory item to share."), memberIds: { type: "array", items: { type: "string" }, description: "Member ids to share it with." } }, ["itemId"]),
  "memory.revoke_share": obj({ itemId: str("Id of the memory item."), memberId: str("Member whose share to withdraw.") }, ["itemId", "memberId"]),
  "document.search": obj({ query: str("Text to match; omit to list all shared documents.") }),
  "document.summarize": obj({ documentId: str("Id of the document to summarize — use an id returned by document.search.") }, ["documentId"]),
  "sphere.note.create": obj({ content: str("The shared note text (visible to the whole Sphere)."), summary: str("Optional short summary.") }, ["content"]),
  "sphere.project.create": obj({ title: str("Project title."), description: str("Optional description.") }, ["title"]),
  "calendar.read": obj({}),
  "calendar.create_event": obj({ title: str("Event title."), start: str("Start time (ISO-8601)."), calendarId: str("Optional target calendar id.") }, ["title", "start"]),
  "message.send": obj({ to: str("Recipient (channel-specific)."), body: str("Message body.") }, ["body"]),
  "payment.execute": obj({ amount: { type: "number", description: "Amount to pay." }, to: str("Payee.") }, ["amount"]),
};

/** A fresh catalog map keyed by capability name, with input schemas attached. */
export function defaultCapabilityCatalog(): ReadonlyMap<string, Capability> {
  return new Map(
    CAPABILITIES.map((c) => {
      const inputSchema = CAPABILITY_INPUT_SCHEMAS[c.name];
      return [c.name, inputSchema !== undefined ? { ...c, inputSchema } : c];
    }),
  );
}
