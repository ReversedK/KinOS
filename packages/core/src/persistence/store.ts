/**
 * Persistence port (ADR-006: "persistence is reached through a repository port
 * defined by the domain; SQLite is the adapter behind it").
 *
 * A SphereStore persists the canonical Sphere snapshot (the documented export
 * format — canonical memory, ownership, visibility, sensitivity, lifecycle,
 * policies). Embeddings are not persisted here; they are derived and
 * regenerable (coding principle 5).
 *
 * This module is pure domain: the interface plus an in-memory reference
 * implementation for tests and ephemeral runs. Durable adapters (SQLite) live
 * outside the core and implement this same contract.
 */

import type { SphereExport } from "../export/export.js";

export interface SphereStore {
  /** Persist a snapshot, overwriting any existing snapshot for its Sphere id. */
  save(snapshot: SphereExport): Promise<void>;
  /** Load a Sphere snapshot, or undefined if none is stored. */
  load(sphereId: string): Promise<SphereExport | undefined>;
  /** List the ids of all stored Spheres. */
  list(): Promise<readonly string[]>;
  /** Remove a Sphere snapshot. Idempotent. */
  delete(sphereId: string): Promise<void>;
}

/** Deep clone via the canonical JSON form (snapshots are JSON-serializable). */
function clone(snapshot: SphereExport): SphereExport {
  return JSON.parse(JSON.stringify(snapshot)) as SphereExport;
}

/**
 * In-memory SphereStore. Stores and returns clones so callers cannot mutate
 * persisted state by holding a reference. Not durable across process restarts —
 * use a SQLite adapter for durability.
 */
export class InMemorySphereStore implements SphereStore {
  private readonly byId = new Map<string, SphereExport>();

  async save(snapshot: SphereExport): Promise<void> {
    this.byId.set(snapshot.sphere.id, clone(snapshot));
  }

  async load(sphereId: string): Promise<SphereExport | undefined> {
    const found = this.byId.get(sphereId);
    return found === undefined ? undefined : clone(found);
  }

  async list(): Promise<readonly string[]> {
    return [...this.byId.keys()];
  }

  async delete(sphereId: string): Promise<void> {
    this.byId.delete(sphereId);
  }
}
