/**
 * Session Resolver (RFC-005 retrieval rule), mirroring the memory resolver.
 *
 * Returns only the sessions a subject is authorized to read. A consumer of the
 * Policy Engine, never an independent gatekeeper: a session is owner-private, so
 * structural visibility (owner-only, non-deleted) is expressed as a
 * lowest-priority synthetic `allow` run through the engine — any real `deny` /
 * `require_approval` still dominates, and a session the subject doesn't own gets
 * no allow and is denied by default.
 *
 * Guardian oversight of a minor's sessions (RFC-005 open question) would widen
 * structural visibility via an explicit grant, like memory's supervisor scope;
 * it is intentionally NOT implicit here.
 *
 * Pure domain: no I/O, no provider/runtime imports.
 */

import { evaluate } from "../policy/engine.js";
import type { Policy, PolicyDecision, PolicyRequest } from "../policy/types.js";
import type { Session } from "./session.js";

export interface SessionReadContext {
  readonly sphereId: string;
  readonly time: string;
  readonly correlationId: string;
}

type Subject = PolicyRequest["subject"];

/** Owner-only, non-deleted. Policy may narrow this; it does not widen it here. */
function structurallyVisible(subject: Subject, session: Session): boolean {
  if (session.state === "deleted") return false;
  return subject.memberId !== undefined && subject.memberId === session.ownerId;
}

function structuralAllow(ctx: SessionReadContext): Policy {
  return {
    id: "session.structural-visibility",
    sphereId: ctx.sphereId,
    description: "Owner of the conversation: structural read access (overridable by deny/approval).",
    subjectSelector: {},
    action: "read",
    resourceSelector: { types: ["session"] },
    effect: "allow",
    priority: Number.MIN_SAFE_INTEGER,
    version: 1,
    status: "active",
  };
}

const DENY_NOT_OWNER: Omit<PolicyDecision, "correlationId"> = {
  effect: "deny",
  reason: "Session is private to its owner; denied by default.",
};

/** Authorize reading one session, combining ownership with policy. */
export function authorizeSessionRead(
  subject: Subject,
  session: Session,
  policies: readonly Policy[],
  ctx: SessionReadContext,
): PolicyDecision {
  if (!structurallyVisible(subject, session)) {
    return { ...DENY_NOT_OWNER, correlationId: ctx.correlationId };
  }
  const request: PolicyRequest = {
    subject,
    action: "read",
    resource: { type: "session", id: session.id },
    context: { sphereId: ctx.sphereId, time: ctx.time, execution: "local", correlationId: ctx.correlationId },
  };
  return evaluate(request, [...policies, structuralAllow(ctx)]);
}

/** Return only the sessions the subject is authorized to read. */
export function resolveReadableSessions(
  subject: Subject,
  sessions: readonly Session[],
  policies: readonly Policy[],
  ctx: SessionReadContext,
): readonly Session[] {
  return sessions.filter((s) => authorizeSessionRead(subject, s, policies, ctx).effect === "allow");
}
