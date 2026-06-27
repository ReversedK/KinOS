/**
 * RuntimeStateSnapshot (RFC-007, domain-model.md).
 *
 * An opaque, restorable backup of an agent's runtime working state (its own
 * sessions, working memory, skills, state DB). **Non-canonical**: distinct from
 * canonical MemoryItems and from KinOS Sessions. KinOS backs it up and restores
 * it without reading its content — the blob is held **by reference only**, so the
 * type deliberately has no `content` field. It provides runtime continuity
 * (crash, restart, migration), not cross-runtime portability.
 *
 * Backup and restore are governed, audited capabilities
 * (`runtime.session.backup`, `runtime.session.restore`); this module is the pure
 * entity + lifecycle the governed flow operates on. The actual blob read/write
 * (encrypt/tar a profile dir, etc.) is an adapter behind the CapabilityExecutor.
 *
 * Pure domain: no provider/runtime imports, no I/O.
 */

export type SnapshotState = "available" | "expired";

export interface RuntimeStateSnapshot {
  readonly id: string;
  readonly agentId: string;
  readonly sphereId: string;
  /** Encrypted blob reference — never inline content (opaque, by reference). */
  readonly ref: string;
  readonly createdAt: string;
  readonly state: SnapshotState;
}

export interface CreateRuntimeStateSnapshotInput {
  readonly id: string;
  readonly agentId: string;
  readonly sphereId: string;
  readonly ref: string;
  readonly createdAt: string;
}

export function createRuntimeStateSnapshot(input: CreateRuntimeStateSnapshotInput): RuntimeStateSnapshot {
  if (input.ref.trim() === "") {
    throw new Error("A snapshot blob reference is required (held by reference only)");
  }
  return {
    id: input.id,
    agentId: input.agentId,
    sphereId: input.sphereId,
    ref: input.ref,
    createdAt: input.createdAt,
    state: "available",
  };
}

export function expireSnapshot(snapshot: RuntimeStateSnapshot): RuntimeStateSnapshot {
  return { ...snapshot, state: "expired" };
}

/**
 * Deny-by-default guard for a restore: the snapshot must be available and must
 * belong to the same agent and Sphere. A snapshot is Hermes-format-bound runtime
 * continuity, not a cross-agent or cross-Sphere transfer.
 */
export function assertSnapshotRestorable(
  snapshot: RuntimeStateSnapshot,
  target: { readonly agentId: string; readonly sphereId: string },
): void {
  if (snapshot.state !== "available") {
    throw new Error(`Snapshot ${snapshot.id} is ${snapshot.state} and cannot be restored`);
  }
  if (snapshot.sphereId !== target.sphereId) {
    throw new Error("Snapshot belongs to a different Sphere; restore refused");
  }
  if (snapshot.agentId !== target.agentId) {
    throw new Error("Snapshot belongs to a different agent; restore refused");
  }
}

/** Persistence port for snapshot records (the metadata, never the blob content). */
export interface SnapshotStore {
  save(snapshot: RuntimeStateSnapshot): Promise<void>;
  load(id: string): Promise<RuntimeStateSnapshot | undefined>;
  /** Newest-first snapshots for an agent. */
  listForAgent(sphereId: string, agentId: string): Promise<readonly RuntimeStateSnapshot[]>;
}
