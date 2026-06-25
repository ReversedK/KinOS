/**
 * Identity — a human (or Sphere) identity, distinct from Member and Agent
 * identity (domain-model.md: "Agent identity is distinct from Sphere identity
 * and from Member identity"). A single Identity can be a Member of several
 * Spheres with different roles (results-contract §3).
 *
 * Pure domain: no I/O, no provider/runtime imports. Ids are caller-supplied.
 */

export interface Identity {
  readonly id: string;
  readonly displayName: string;
}

export interface CreateIdentityInput {
  readonly id: string;
  readonly displayName: string;
}

export function createIdentity(input: CreateIdentityInput): Identity {
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new Error("Identity displayName must not be empty");
  }
  return { id: input.id, displayName };
}
