/**
 * Durable SQLite audit sink.
 *
 * Implements @kinos/core's AuditSink over an append-only `audit_events` table.
 * Events carry only security facts (ids, references, decision class, deciding
 * policy, correlation id) — never private content (privacy-model.md, audit
 * minimality). The table has no content column, so content cannot leak.
 */

import Database from "better-sqlite3";
import type { AuditReader, AuditSink, EventDecision, KinEvent, KinEventDraft, KinEventType } from "@kinos/core";

interface AuditRow {
  readonly seq: number;
  readonly type: string;
  readonly sphere_id: string;
  readonly actor_id: string | null;
  readonly agent_id: string | null;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly decision: string | null;
  readonly reason: string | null;
  readonly policy_id: string | null;
  readonly policy_version: number | null;
  readonly correlation_id: string;
  readonly created_at: string;
}

export class SqliteAuditSink implements AuditSink, AuditReader {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS audit_events (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         type TEXT NOT NULL,
         sphere_id TEXT NOT NULL,
         actor_id TEXT,
         agent_id TEXT,
         resource_type TEXT,
         resource_id TEXT,
         decision TEXT,
         reason TEXT,
         policy_id TEXT,
         policy_version INTEGER,
         correlation_id TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
    );
    // Read paths: the Sphere activity tail (RFC-020) and the correlation chain.
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_audit_sphere_seq ON audit_events (sphere_id, seq DESC)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events (correlation_id)");
  }

  record(event: KinEventDraft): void {
    this.db
      .prepare(
        `INSERT INTO audit_events
           (type, sphere_id, actor_id, agent_id, resource_type, resource_id,
            decision, reason, policy_id, policy_version, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.type,
        event.sphereId,
        event.actorId ?? null,
        event.agentId ?? null,
        event.resourceType ?? null,
        event.resourceId ?? null,
        event.decision ?? null,
        event.reason ?? null,
        event.policyId ?? null,
        event.policyVersion ?? null,
        event.correlationId,
        event.createdAt,
      );
  }

  byCorrelation(correlationId: string): readonly KinEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events WHERE correlation_id = ? ORDER BY seq")
      .all(correlationId) as AuditRow[];
    return rows.map(toEvent);
  }

  /**
   * Most recent events for one Sphere, newest first (RFC-020). Bounded by `limit`
   * so an audit read can never drain the log.
   */
  recentBySphere(sphereId: string, limit: number): readonly KinEvent[] {
    if (limit <= 0) return [];
    const rows = this.db
      .prepare("SELECT * FROM audit_events WHERE sphere_id = ? ORDER BY seq DESC LIMIT ?")
      .all(sphereId, limit) as AuditRow[];
    return rows.map(toEvent);
  }

  /** All recorded events in insertion order. */
  all(): readonly KinEvent[] {
    const rows = this.db.prepare("SELECT * FROM audit_events ORDER BY seq").all() as AuditRow[];
    return rows.map(toEvent);
  }

  close(): void {
    this.db.close();
  }
}

function toEvent(row: AuditRow): KinEvent {
  return {
    id: `evt_${row.seq}`,
    type: row.type as KinEventType,
    sphereId: row.sphere_id,
    ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
    ...(row.agent_id !== null ? { agentId: row.agent_id } : {}),
    ...(row.resource_type !== null ? { resourceType: row.resource_type } : {}),
    ...(row.resource_id !== null ? { resourceId: row.resource_id } : {}),
    ...(row.decision !== null ? { decision: row.decision as EventDecision } : {}),
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.policy_id !== null ? { policyId: row.policy_id } : {}),
    ...(row.policy_version !== null ? { policyVersion: row.policy_version } : {}),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}
