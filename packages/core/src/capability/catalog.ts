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
];

/** A fresh catalog map keyed by capability name. */
export function defaultCapabilityCatalog(): ReadonlyMap<string, Capability> {
  return new Map(CAPABILITIES.map((c) => [c.name, c]));
}
