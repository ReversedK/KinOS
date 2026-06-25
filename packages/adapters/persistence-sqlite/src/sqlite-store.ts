/**
 * SQLite persistence adapter.
 *
 * Implements @kinos/core's SphereStore port via better-sqlite3. Provider code —
 * it lives outside the domain core and decides no permissions (coding principle
 * 8). It stores the canonical Sphere export snapshot as JSON, keyed by Sphere
 * id; embeddings are derived and not persisted here.
 */

import Database from "better-sqlite3";
import type { SphereExport, SphereStore } from "@kinos/core";

export class SqliteSphereStore implements SphereStore {
  private readonly db: Database.Database;

  /** Open (or create) the database at `filename`. Use ":memory:" for ephemeral. */
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS spheres (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL)",
    );
  }

  async save(snapshot: SphereExport): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO spheres (id, snapshot) VALUES (?, ?)")
      .run(snapshot.sphere.id, JSON.stringify(snapshot));
  }

  async load(sphereId: string): Promise<SphereExport | undefined> {
    const row = this.db
      .prepare("SELECT snapshot FROM spheres WHERE id = ?")
      .get(sphereId) as { snapshot: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.snapshot) as SphereExport);
  }

  async list(): Promise<readonly string[]> {
    const rows = this.db
      .prepare("SELECT id FROM spheres ORDER BY id")
      .all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async delete(sphereId: string): Promise<void> {
    this.db.prepare("DELETE FROM spheres WHERE id = ?").run(sphereId);
  }

  /** Close the underlying database handle. */
  close(): void {
    this.db.close();
  }
}
