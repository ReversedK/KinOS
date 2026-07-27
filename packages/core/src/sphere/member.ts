/**
 * Member — a human (or Sphere) participating in a Sphere.
 * Domain vocabulary: docs/domain/domain-model.md, docs/domain/entity-lifecycle.md.
 *
 * Pure domain: no I/O, no provider/runtime imports.
 */

import type { AgeProfile } from "../policy/types.js";

/**
 * Governance role — WHAT authority a member holds in a Sphere (RFC-042), separate
 * from age. Generic so KinOS reads for any group, not just a family: `admin` has
 * full authority, `member` is an ordinary participant, `guest` is limited.
 */
export type GovernanceRole = "admin" | "member" | "guest";

/**
 * Legacy family roles (pre-RFC-042). Still ACCEPTED on member creation / import and
 * normalized to a governance role + age profile; never the canonical stored form for
 * a new Member. Retained in the union so existing Spheres and exports load unchanged.
 */
export type LegacyRole = "parent" | "teenager" | "child";

/** A Sphere role: a generic governance role, or a legacy family role (normalized). */
export type Role = GovernanceRole | LegacyRole;

/** Legacy role → { governance role, age profile } (RFC-042 import normalization). */
export function normalizeRole(role: Role): { role: GovernanceRole; ageProfile: AgeProfile } {
  switch (role) {
    case "parent":
      return { role: "admin", ageProfile: "adult" };
    case "teenager":
      return { role: "member", ageProfile: "teen" };
    case "child":
      return { role: "member", ageProfile: "child" };
    case "admin":
    case "member":
    case "guest":
      return { role, ageProfile: "adult" };
  }
}

/** Member lifecycle states (entity-lifecycle.md → Member lifecycle). */
export type MemberStatus =
  | "invited"
  | "active"
  | "suspended"
  | "left"
  | "removed"
  | "anonymized";

export interface Member {
  readonly id: string;
  /** The identity this membership represents (identity ≠ member ≠ agent). */
  readonly identityId: string;
  /** Governance authority (RFC-042) — independent of age. */
  readonly role: Role;
  /**
   * The member's supervision profile (RFC-042) — the safety dimension, independent
   * of role. Optional for backward compatibility with pre-RFC-042 members/snapshots;
   * when absent, `effectiveAgeProfile` derives it from a legacy role.
   */
  readonly ageProfile?: AgeProfile;
  readonly status: MemberStatus;
}

/**
 * A member's effective age profile (RFC-042): the explicit field wins; a member
 * without one (legacy) falls back to the age its role implied. This is the source of
 * truth for minor-safety floors — never the governance role.
 */
export function effectiveAgeProfile(member: { role: Role; ageProfile?: AgeProfile }): AgeProfile {
  return member.ageProfile ?? normalizeRole(member.role).ageProfile;
}

/**
 * Minors are priority safety cases (results-contract §8): child and teen profiles
 * are minors and restricted by default. Keyed on the AGE PROFILE (RFC-042), not the
 * governance role.
 */
export function isMinor(ageProfile: AgeProfile): boolean {
  return ageProfile === "child" || ageProfile === "teen";
}
