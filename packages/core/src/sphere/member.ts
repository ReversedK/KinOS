/**
 * Member — a human (or Sphere) participating in a Sphere.
 * Domain vocabulary: docs/domain/domain-model.md, docs/domain/entity-lifecycle.md.
 *
 * Pure domain: no I/O, no provider/runtime imports.
 */

/**
 * Minimum family roles (results-contract §3). Roles are scoped to a Sphere;
 * the same identity may hold different roles in different Spheres.
 */
export type Role = "parent" | "teenager" | "child" | "guest";

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
  readonly role: Role;
  readonly status: MemberStatus;
}

/**
 * Minors are priority safety cases (results-contract §8): child and teenager
 * profiles are minors and restricted by default.
 */
const MINOR_ROLES: ReadonlySet<Role> = new Set<Role>(["child", "teenager"]);

export function isMinor(role: Role): boolean {
  return MINOR_ROLES.has(role);
}
