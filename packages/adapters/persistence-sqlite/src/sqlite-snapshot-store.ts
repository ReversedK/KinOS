/**
 * Durable SQLite snapshot store (RFC-007, ADR-007).
 *
 * Persists RuntimeStateSnapshot *records* (metadata + the blob reference), never
 * the blob content — the encrypted blob lives in the RuntimeStateBlobStore. Rows
 * carry sphere_id / agent_id / created_at / state so listForAgent filters and
 * orders without parsing every row.
 */

import Database from "better-sqlite3";
import type { RuntimeStateSnapshot, SnapshotStore } from "@kinos/core";

interface Row {
  readonly payload: string;
}

export class SqliteSnapshotStore implements SnapshotStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS snapshots (
         id TEXT PRIMARY KEY,
         sphere_id TEXT NOT NULL,
         agent_id TEXT NOT NULL,
         created_at TEXT NOT NULL,
         state TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
    );
  }

  async save(s: RuntimeStateSnapshot): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshots (id, sphere_id, agent_id, created_at, state, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.sphereId, s.agentId, s.createdAt, s.state, JSON.stringify(s));
  }

  async load(id: string): Promise<RuntimeStateSnapshot | undefined> {
    const row = this.db.prepare("SELECT payload FROM snapshots WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? undefined : (JSON.parse(row.payload) as RuntimeStateSnapshot);
  }

  async listForAgent(sphereId: string, agentId: string): Promise<readonly RuntimeStateSnapshot[]> {
    const rows = this.db
      .prepare(
        `SELECT payload FROM snapshots
         WHERE sphere_id = ? AND agent_id = ?
         ORDER BY created_at DESC, id`,
      )
      .all(sphereId, agentId) as Row[];
    return rows.map((r) => JSON.parse(r.payload) as RuntimeStateSnapshot);
  }

  close(): void {
    this.db.close();
  }
}
