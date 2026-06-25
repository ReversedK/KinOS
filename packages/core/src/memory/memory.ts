/**
 * MemoryItem — canonical, durable, governed memory (ADR-002).
 *
 * The Memory Item is canonical; embeddings/indexes are derived and regenerable
 * (coding principle 5) and are NOT modelled here. Pure domain: no I/O, no
 * provider/runtime imports; timestamps and ids are supplied by the caller.
 */

import type { Classification, Sensitivity } from "../policy/types.js";

/** Visibility scope == the policy Classification union (ADR-002 / ADR-003). */
export type Visibility = Classification;

export type MemoryState =
  | "active"
  | "archived"
  | "revoked"
  | "deletion_requested"
  | "purged";

export type MemorySource = "manual" | "conversation" | "import" | "integration";

export interface ShareGrant {
  readonly subjectId: string;
  readonly grantedBy: string;
  readonly grantedAt: string;
  /** Set on revocation; the grant is retained as an audit fact (invariant 5). */
  readonly revokedAt?: string;
}

export interface MemoryItem {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerType: "member" | "sphere";
  readonly sphereId: string;
  readonly visibility: Visibility;
  readonly shareGrants?: readonly ShareGrant[];
  readonly sensitivity: Sensitivity;
  readonly content: string;
  readonly summary?: string;
  readonly source: MemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: MemoryState;
  readonly auditRefs: readonly string[];
}

export interface CreateMemoryInput {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerType: "member" | "sphere";
  readonly sphereId: string;
  readonly content: string;
  readonly source: MemorySource;
  readonly now: string;
  readonly summary?: string;
  readonly sensitivity?: Sensitivity;
}

/**
 * Create a Memory Item. New memory is `private` by default (ADR-002); a scope
 * is never widened by silence — only an explicit share widens it.
 */
export function createMemoryItem(input: CreateMemoryInput): MemoryItem {
  const content = input.content.trim();
  if (content.length === 0) {
    throw new Error("MemoryItem content must not be empty");
  }
  return {
    id: input.id,
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    sphereId: input.sphereId,
    visibility: "private",
    sensitivity: input.sensitivity ?? "normal",
    content,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    source: input.source,
    createdAt: input.now,
    updatedAt: input.now,
    state: "active",
    auditRefs: [],
  };
}

export interface ShareWithMembersInput {
  readonly subjectIds: readonly string[];
  readonly grantedBy: string;
  readonly now: string;
}

/**
 * Share a Memory Item with explicit member/agent subjects. Adds grants and sets
 * visibility to `shared_with_members`. Ownership never changes (invariant 20).
 * Returns a new item; the input is not mutated.
 */
export function shareWithMembers(item: MemoryItem, input: ShareWithMembersInput): MemoryItem {
  if (input.subjectIds.length === 0) {
    throw new Error("shareWithMembers requires at least one subject");
  }
  const newGrants: ShareGrant[] = input.subjectIds.map((subjectId) => ({
    subjectId,
    grantedBy: input.grantedBy,
    grantedAt: input.now,
  }));
  return {
    ...item,
    visibility: "shared_with_members",
    shareGrants: [...(item.shareGrants ?? []), ...newGrants],
    updatedAt: input.now,
  };
}

export interface RevokeShareInput {
  readonly subjectId: string;
  readonly now: string;
}

/**
 * Revoke a subject's share. Sets `revokedAt` on their active grant(s) and keeps
 * the grant as an audit fact. Revocation blocks future access; it does not
 * delete the item or change ownership (ADR-002: revocation != deletion).
 * Returns a new item; the input is not mutated.
 */
export function revokeShare(item: MemoryItem, input: RevokeShareInput): MemoryItem {
  const grants = item.shareGrants ?? [];
  const updated = grants.map((g) =>
    g.subjectId === input.subjectId && g.revokedAt === undefined
      ? { ...g, revokedAt: input.now }
      : g,
  );
  return { ...item, shareGrants: updated, updatedAt: input.now };
}

export function hasActiveGrant(item: MemoryItem, subjectId: string): boolean {
  return (item.shareGrants ?? []).some(
    (g) => g.subjectId === subjectId && g.revokedAt === undefined,
  );
}
