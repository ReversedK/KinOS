/**
 * CLI commands over a SphereStore.
 *
 * Command logic is provider-free: it takes an injected SphereStore (the CLI
 * wires SQLite; tests wire in-memory) and the domain core. This proves
 * results-contract §1 ("the database is initialized") and §15 (local-first
 * durability): a Sphere created here is persisted and read back later.
 */

import {
  createIdentity,
  createSphere,
  exportSphere,
  importSphere,
  type SphereStore,
} from "@kinos/core";

export interface InitSphereArgs {
  readonly id: string;
  readonly name: string;
  readonly founderName: string;
  readonly now: string;
}

/** Create a family Sphere with a founding parent and persist it. */
export async function initSphere(store: SphereStore, args: InitSphereArgs): Promise<string> {
  if ((await store.load(args.id)) !== undefined) {
    throw new Error(`Sphere ${args.id} already exists`);
  }
  const founderIdentityId = `idy_${args.id}_founder`;
  const sphere = createSphere({
    id: args.id,
    type: "family",
    name: args.name,
    founder: { memberId: `mbr_${args.id}_founder`, identityId: founderIdentityId, role: "parent" },
  });
  const founder = createIdentity({ id: founderIdentityId, displayName: args.founderName });
  const snapshot = exportSphere({
    sphere,
    identities: [founder],
    agents: [],
    memory: [],
    policies: [],
    exportedAt: args.now,
  });
  await store.save(snapshot);
  return `Initialized Sphere ${args.id} ("${args.name}").`;
}

export async function listSpheres(store: SphereStore): Promise<string> {
  const ids = await store.list();
  return ids.length === 0 ? "(no Spheres)" : ids.join("\n");
}

export async function showSphere(store: SphereStore, id: string): Promise<string> {
  const snap = await store.load(id);
  if (snap === undefined) return `Sphere ${id} not found.`;
  return [
    `id: ${snap.sphere.id}`,
    `name: ${snap.sphere.name}`,
    `type: ${snap.sphere.type}`,
    `status: ${snap.sphere.status}`,
    `members: ${snap.sphere.members.length}`,
    `identities: ${snap.identities.length}`,
  ].join("\n");
}

/** Load and re-validate a snapshot, returning its documented JSON form. */
export async function exportSphereJson(store: SphereStore, id: string): Promise<string> {
  const snap = await store.load(id);
  if (snap === undefined) throw new Error(`Sphere ${id} not found`);
  // Round-trip through importSphere to validate the stored snapshot before emit.
  const validated = importSphere(snap);
  return JSON.stringify(
    exportSphere({ ...validated, exportedAt: validated.exportedAt }),
    null,
    2,
  );
}
