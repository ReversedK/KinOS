/**
 * Sphere — a governed unit of human representation.
 * Domain vocabulary: docs/domain/domain-model.md.
 * Lifecycle: docs/domain/entity-lifecycle.md (draft → active → …).
 *
 * Pure domain: no I/O, no provider/runtime imports. Identifiers are supplied by
 * the caller (adapters/application layer generate them), keeping the core
 * deterministic and free of any crypto/random dependency.
 */

import type { Member, Role } from "./member.js";

/** Minimum Sphere types (results-contract §2). */
export type SphereType = "person" | "family" | "team" | "organization";

/** Sphere lifecycle states (entity-lifecycle.md → Sphere lifecycle). */
export type SphereStatus =
  | "draft"
  | "active"
  | "suspended"
  | "archived"
  | "deletion_requested"
  | "deleted";

export interface Sphere {
  readonly id: string;
  readonly type: SphereType;
  readonly name: string;
  readonly status: SphereStatus;
  /** Member ids with administrative authority over the Sphere. */
  readonly administrators: readonly string[];
  readonly members: readonly Member[];
}

export interface MemberInput {
  readonly memberId: string;
  readonly identityId: string;
  readonly role: Role;
}

export interface CreateSphereInput {
  readonly id: string;
  readonly type: SphereType;
  readonly name: string;
  /** The creating member; becomes the first member and an administrator (§2). */
  readonly founder: MemberInput;
}

function activeMember(input: MemberInput): Member {
  return {
    id: input.memberId,
    identityId: input.identityId,
    role: input.role,
    status: "active",
  };
}

/**
 * Create a Sphere. An administrator can create a Sphere (results-contract §2);
 * the founder is recorded as the first member and as an administrator. The
 * Sphere is initialized ready-to-use, i.e. `active` (entity-lifecycle: draft →
 * active "initialized and ready").
 */
export function createSphere(input: CreateSphereInput): Sphere {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Sphere name must not be empty");
  }
  const founder = activeMember(input.founder);
  return {
    id: input.id,
    type: input.type,
    name,
    status: "active",
    administrators: [founder.id],
    members: [founder],
  };
}

/**
 * Add a member to a Sphere, returning a new Sphere (the input is not mutated).
 * Duplicate member ids are refused (deny by default — coding principle 6).
 */
export function addMember(sphere: Sphere, input: MemberInput): Sphere {
  if (sphere.members.some((m) => m.id === input.memberId)) {
    throw new Error(`Member ${input.memberId} already exists in Sphere ${sphere.id}`);
  }
  return {
    ...sphere,
    members: [...sphere.members, activeMember(input)],
  };
}

export function listMembers(sphere: Sphere): readonly Member[] {
  return sphere.members;
}

/**
 * Archive a Sphere (RFC-024): a soft, reversible status flip — no data or audit is
 * destroyed. A `deleted` Sphere cannot be archived (fail closed on an invalid
 * transition). Idempotent on an already-archived Sphere.
 */
export function archiveSphere(sphere: Sphere): Sphere {
  if (sphere.status === "deleted" || sphere.status === "deletion_requested") {
    throw new Error(`Sphere ${sphere.id} is ${sphere.status} and cannot be archived`);
  }
  return { ...sphere, status: "archived" };
}

/** Restore an archived Sphere to active (RFC-024). Only an archived Sphere restores. */
export function unarchiveSphere(sphere: Sphere): Sphere {
  if (sphere.status !== "archived") {
    throw new Error(`Sphere ${sphere.id} is ${sphere.status}, not archived; nothing to restore`);
  }
  return { ...sphere, status: "active" };
}
