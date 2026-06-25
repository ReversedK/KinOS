/**
 * Durable SQLite approval store.
 *
 * Implements @kinos/core's ApprovalStore over a `pending_actions` table, storing
 * each PendingSensitiveAction as JSON keyed by approval id, with sphere_id and
 * state columns so listPending() can filter without parsing every row. Lets the
 * suspend → grant → execute loop span processes.
 */

import Database from "better-sqlite3";
import type { ApprovalStore, PendingSensitiveAction } from "@kinos/core";

interface PendingRow {
  readonly payload: string;
}

export class SqliteApprovalStore implements ApprovalStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS pending_actions (
         approval_id TEXT PRIMARY KEY,
         sphere_id TEXT NOT NULL,
         state TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
    );
  }

  async save(pending: PendingSensitiveAction): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_actions (approval_id, sphere_id, state, payload)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        pending.approval.id,
        pending.approval.sphereId,
        pending.approval.state,
        JSON.stringify(pending),
      );
  }

  async load(approvalId: string): Promise<PendingSensitiveAction | undefined> {
    const row = this.db
      .prepare("SELECT payload FROM pending_actions WHERE approval_id = ?")
      .get(approvalId) as PendingRow | undefined;
    return row === undefined ? undefined : (JSON.parse(row.payload) as PendingSensitiveAction);
  }

  async listPending(sphereId?: string): Promise<readonly PendingSensitiveAction[]> {
    const rows =
      sphereId === undefined
        ? (this.db
            .prepare("SELECT payload FROM pending_actions WHERE state = 'pending' ORDER BY approval_id")
            .all() as PendingRow[])
        : (this.db
            .prepare(
              "SELECT payload FROM pending_actions WHERE state = 'pending' AND sphere_id = ? ORDER BY approval_id",
            )
            .all(sphereId) as PendingRow[]);
    return rows.map((r) => JSON.parse(r.payload) as PendingSensitiveAction);
  }

  async delete(approvalId: string): Promise<void> {
    this.db.prepare("DELETE FROM pending_actions WHERE approval_id = ?").run(approvalId);
  }

  close(): void {
    this.db.close();
  }
}
