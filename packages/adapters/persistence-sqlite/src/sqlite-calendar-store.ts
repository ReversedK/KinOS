/**
 * Durable SQLite calendar store (RFC-012).
 *
 * Implements @kinos/core's CalendarStore over a `calendar_events` table keyed by
 * id, with a `sphere_id` column so `listBySphere` filters to one Sphere without
 * parsing every row. Sphere content in its own table — separate from the Sphere
 * snapshot, canonical memory and the audit log.
 *
 * The Sphere id is the isolation boundary: callers pass it from the governed
 * ExecutionContext, and this store only ever returns a Sphere its own events.
 */

import Database from "better-sqlite3";
import type { CalendarEvent, CalendarStore } from "@kinos/core";

interface EventRow {
  readonly payload: string;
}

export class SqliteCalendarStore implements CalendarStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS calendar_events (
         id TEXT PRIMARY KEY,
         sphere_id TEXT NOT NULL,
         start TEXT NOT NULL,
         created_at TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
    );
  }

  async create(event: CalendarEvent): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO calendar_events (id, sphere_id, start, created_at, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.id, event.sphereId, event.start, event.createdAt, JSON.stringify(event));
  }

  async listBySphere(sphereId: string): Promise<readonly CalendarEvent[]> {
    const rows = this.db
      .prepare("SELECT payload FROM calendar_events WHERE sphere_id = ? ORDER BY start, id")
      .all(sphereId) as EventRow[];
    return rows.map((r) => JSON.parse(r.payload) as CalendarEvent);
  }
}
