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
];

/** A fresh catalog map keyed by capability name. */
export function defaultCapabilityCatalog(): ReadonlyMap<string, Capability> {
  return new Map(CAPABILITIES.map((c) => [c.name, c]));
}
