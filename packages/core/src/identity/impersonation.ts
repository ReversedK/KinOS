/**
 * Developer impersonation — dev-only "act as <member>" identity resolution
 * (RFC-006).
 *
 * Impersonation SELECTS whose rights apply; it never adds rights. The resolved
 * subject carries the target member's real role and age profile, so the Policy
 * Engine then governs exactly as it would for that member (a minor stays
 * restricted; nothing is elevated). It is gated behind a dev flag passed in by
 * the caller — the core reads no environment (coding principle 1) — and is
 * deny-by-default: flag off, unknown member or inactive member all refuse
 * (coding principle 6).
 *
 * This module returns the resolved subject plus the facts an audit sink should
 * record (impersonated member + developer); the app layer emits the audit event
 * and reads the dev flag from the environment.
 */

import type { Member, Role } from "../sphere/member.js";
import type { AgeProfile } from "../policy/types.js";

/** Map a Sphere role to its age profile. Minors map to teen/child; others adult. */
export function ageProfileForRole(role: Role): AgeProfile {
  switch (role) {
    case "teenager":
      return "teen";
    case "child":
      return "child";
    case "parent":
    case "guest":
      return "adult";
  }
}

export interface ImpersonationRequest {
  /** The member to act as. */
  readonly actAsMemberId: string;
  /** Who is impersonating (recorded for audit; never grants rights). */
  readonly byDeveloper: string;
  /** Dev-only gate. When false, impersonation does not exist (deny by default). */
  readonly devImpersonationEnabled: boolean;
}

export interface ImpersonatedSubject {
  readonly memberId: string;
  readonly role: Role;
  readonly ageProfile: AgeProfile;
}

export interface ResolvedImpersonation {
  /** The acting subject for the Policy Engine — the member's real role/profile. */
  readonly subject: ImpersonatedSubject;
  /** Audit facts: an impersonation, by whom, of whom (security facts only). */
  readonly impersonated: true;
  readonly impersonatedBy: string;
}

/**
 * Resolve the subject for a dev impersonation request against the Sphere's
 * membership. Fails closed: disabled flag, unknown member or non-active member
 * all throw rather than guess. Grants nothing — the returned subject is governed
 * by the Policy Engine like any other.
 */
export function resolveImpersonatedSubject(
  members: readonly Member[],
  req: ImpersonationRequest,
): ResolvedImpersonation {
  if (!req.devImpersonationEnabled) {
    throw new Error("Developer impersonation is disabled");
  }
  const member = members.find((m) => m.id === req.actAsMemberId);
  if (member === undefined) {
    throw new Error(`Member ${req.actAsMemberId} not found in Sphere`);
  }
  if (member.status !== "active") {
    throw new Error(`Member ${req.actAsMemberId} is not active (status ${member.status})`);
  }
  return {
    subject: {
      memberId: member.id,
      role: member.role,
      ageProfile: ageProfileForRole(member.role),
    },
    impersonated: true,
    impersonatedBy: req.byDeveloper,
  };
}
