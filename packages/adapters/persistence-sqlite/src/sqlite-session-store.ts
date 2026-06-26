/**
 * Durable SQLite session store (RFC-005).
 *
 * Implements @kinos/core's SessionStore over a `sessions` table, storing each
 * Session as JSON keyed by id, with sphere_id / owner_id / state / updated_at
 * columns so listForOwner() filters and orders without parsing every row.
 * Transcripts are owner-private conversational content — kept in their own table,
 * separate from the Sphere snapshot, canonical memory and the audit log.
 */

import Database from "better-sqlite3";
import type { Session, SessionStore } from "@kinos/core";

interface SessionRow {
  readonly payload: string;
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         id TEXT PRIMARY KEY,
         sphere_id TEXT NOT NULL,
         owner_id TEXT NOT NULL,
         state TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
    );
  }

  async save(session: Session): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, sphere_id, owner_id, state, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(session.id, session.sphereId, session.ownerId, session.state, session.updatedAt, JSON.stringify(session));
  }

  async load(id: string): Promise<Session | undefined> {
    const row = this.db.prepare("SELECT payload FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row === undefined ? undefined : (JSON.parse(row.payload) as Session);
  }

  async listForOwner(sphereId: string, ownerId: string): Promise<readonly Session[]> {
    const rows = this.db
      .prepare(
        `SELECT payload FROM sessions
         WHERE sphere_id = ? AND owner_id = ? AND state != 'deleted'
         ORDER BY updated_at DESC, id`,
      )
      .all(sphereId, ownerId) as SessionRow[];
    return rows.map((r) => JSON.parse(r.payload) as Session);
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
