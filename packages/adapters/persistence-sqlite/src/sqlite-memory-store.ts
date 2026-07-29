/**
 * Durable SQLite memory store (ADR-009 / RFC-044).
 *
 * Implements @kinos/core's MemoryStore over a dedicated `memory` table — canonical
 * memory in its own store, separate from the Sphere snapshot, the calendar store and
 * the audit log. Governance-relevant fields are indexed columns (sphere_id, owner_id,
 * owner_type, visibility, state, updated_at) so a Sphere-scoped read filters without
 * parsing every row; the full Memory Item is stored as JSON (the canonical source of
 * truth — embeddings stay derived and are not stored here).
 *
 * The Sphere id is the isolation boundary: every query is keyed by it, and the store
 * only ever returns a Sphere its own items. A `memory.capture` is a single-row insert
 * — it does not rewrite the Sphere snapshot.
 */

import Database from "better-sqlite3";
import type { MemoryItem, MemoryStore } from "@kinos/core";

interface ItemRow {
  readonly item: string;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS memory (
         id TEXT PRIMARY KEY,
         sphere_id TEXT NOT NULL,
         owner_id TEXT NOT NULL,
         owner_type TEXT NOT NULL,
         visibility TEXT NOT NULL,
         state TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         item TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS memory_sphere_state ON memory (sphere_id, state);
       CREATE INDEX IF NOT EXISTS memory_sphere_owner ON memory (sphere_id, owner_id);`,
    );
  }

  private write(item: MemoryItem): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory
           (id, sphere_id, owner_id, owner_type, visibility, state, updated_at, item)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.sphereId,
        item.ownerId,
        item.ownerType,
        item.visibility,
        item.state,
        item.updatedAt,
        JSON.stringify(item),
      );
  }

  async append(item: MemoryItem): Promise<void> {
    this.write(item);
  }

  /** Update an existing item (share/revoke/lifecycle). Same row, by id. */
  async replace(item: MemoryItem): Promise<void> {
    this.write(item);
  }

  async get(sphereId: string, id: string): Promise<MemoryItem | undefined> {
    const row = this.db
      .prepare("SELECT item FROM memory WHERE sphere_id = ? AND id = ?")
      .get(sphereId, id) as ItemRow | undefined;
    return row === undefined ? undefined : (JSON.parse(row.item) as MemoryItem);
  }

  async listBySphere(sphereId: string): Promise<readonly MemoryItem[]> {
    const rows = this.db
      .prepare("SELECT item FROM memory WHERE sphere_id = ? ORDER BY id")
      .all(sphereId) as ItemRow[];
    return rows.map((r) => JSON.parse(r.item) as MemoryItem);
  }

  async deleteBySphere(sphereId: string): Promise<void> {
    this.db.prepare("DELETE FROM memory WHERE sphere_id = ?").run(sphereId);
  }
}
