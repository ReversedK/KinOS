/**
 * Memory Resolver (ADR-002 retrieval rule).
 *
 * Returns only the memory a subject is authorized to read. It is a *consumer*
 * of Policy Engine decisions, never an independent gatekeeper: structural
 * visibility (ownership, scope, active grants) is expressed as a lowest-priority
 * synthetic `allow` and run through the engine, so any real `deny` /
 * `require_approval` (e.g. medical) still dominates by the engine's fixed
 * precedence, and an item with no structural visibility never gets an allow and
 * is denied by default.
 *
 * Pure domain: no I/O, no provider/runtime imports.
 */

import { evaluate } from "../policy/engine.js";
import type { Policy, PolicyDecision, PolicyRequest } from "../policy/types.js";
import { hasActiveGrant, type MemoryItem } from "./memory.js";

export interface MemoryReadContext {
  readonly sphereId: string;
  readonly time: string;
  readonly correlationId: string;
}

type Subject = PolicyRequest["subject"];

const SUPERVISOR_ROLES: ReadonlySet<string> = new Set(["parent", "admin"]);

/**
 * Whether the subject can structurally see the item from the memory model
 * alone (before governance policies are applied). Only `active` items are
 * candidates; archived/revoked/etc. are not surfaced by default.
 */
function structurallyVisible(subject: Subject, item: MemoryItem): boolean {
  if (item.state !== "active") return false;

  // Owner sees their own memory regardless of scope.
  if (item.ownerType === "member" && subject.memberId === item.ownerId) return true;

  switch (item.visibility) {
    case "private":
      return false;
    case "shared_with_members": {
      const ids = [subject.memberId, subject.agentId].filter((v): v is string => v !== undefined);
      return ids.some((id) => hasActiveGrant(item, id));
    }
    case "shared_with_supervisors":
      return SUPERVISOR_ROLES.has(subject.role);
    case "shared_with_sphere":
      // Visible to members/agents of the owning Sphere. The resolver is invoked
      // with subjects of this Sphere; sensitivity denials still apply via policy.
      return subject.memberId !== undefined || subject.agentId !== undefined;
    case "public_exportable":
      return true;
    default:
      return false;
  }
}

function structuralAllow(item: MemoryItem, ctx: MemoryReadContext): Policy {
  return {
    id: "mem.structural-visibility",
    sphereId: ctx.sphereId,
    description: "Within visibility scope: structural read access (overridable by deny/approval).",
    subjectSelector: {},
    action: "read",
    resourceSelector: { types: ["memory"] },
    effect: "allow",
    // Lowest priority so a real allow policy, if any, is cited instead; the
    // effect is unchanged either way.
    priority: Number.MIN_SAFE_INTEGER,
    version: 1,
    status: "active",
  };
}

const DENY_OUT_OF_SCOPE: Omit<PolicyDecision, "correlationId"> = {
  effect: "deny",
  reason: "Memory item is not within the subject's visibility scope; denied by default.",
};

/** Authorize a single read, combining structural visibility with policy. */
export function authorizeMemoryRead(
  subject: Subject,
  item: MemoryItem,
  policies: readonly Policy[],
  ctx: MemoryReadContext,
): PolicyDecision {
  if (!structurallyVisible(subject, item)) {
    return { ...DENY_OUT_OF_SCOPE, correlationId: ctx.correlationId };
  }
  const request: PolicyRequest = {
    subject,
    action: "read",
    resource: {
      type: "memory",
      id: item.id,
      classification: item.visibility,
      sensitivity: item.sensitivity,
    },
    context: {
      sphereId: ctx.sphereId,
      time: ctx.time,
      execution: "local",
      correlationId: ctx.correlationId,
    },
  };
  return evaluate(request, [...policies, structuralAllow(item, ctx)]);
}

/** Return only the items the subject is authorized to read. */
export function resolveReadableMemory(
  subject: Subject,
  items: readonly MemoryItem[],
  policies: readonly Policy[],
  ctx: MemoryReadContext,
): readonly MemoryItem[] {
  return items.filter((item) => authorizeMemoryRead(subject, item, policies, ctx).effect === "allow");
}
