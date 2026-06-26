/**
 * Session persistence port (RFC-005; ADR-006 repository-port pattern).
 *
 * A SessionStore persists chat Sessions (transcript for continuity). Sessions are
 * owner-private conversational content — kept separate from the canonical Sphere
 * snapshot, from canonical memory, and from the audit log. Read remains
 * policy-scoped (the resolver layer); the store is a plain repository.
 *
 * Pure domain: the interface plus an in-memory reference implementation. Durable
 * adapters (SQLite) implement this same contract outside the core.
 */

import type { Session } from "./session.js";

export interface SessionStore {
  /** Persist a session, overwriting any existing one with the same id. */
  save(session: Session): Promise<void>;
  /** Load a session by id, or undefined if none is stored. */
  load(id: string): Promise<Session | undefined>;
  /**
   * List a member's sessions in a Sphere, most-recently-updated first, excluding
   * deleted ones. Owner-scoped at the data layer; policy still governs access.
   */
  listForOwner(sphereId: string, ownerId: string): Promise<readonly Session[]>;
  /** Remove a session. Idempotent. */
  delete(id: string): Promise<void>;
}

/** Deep clone via JSON (sessions are JSON-serializable) so callers can't mutate state. */
function clone(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session;
}

/**
 * In-memory SessionStore. Stores and returns clones. Not durable across restarts
 * — use a SQLite adapter for durability.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly byId = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.byId.set(session.id, clone(session));
  }

  async load(id: string): Promise<Session | undefined> {
    const found = this.byId.get(id);
    return found === undefined ? undefined : clone(found);
  }

  async listForOwner(sphereId: string, ownerId: string): Promise<readonly Session[]> {
    return [...this.byId.values()]
      .filter((s) => s.sphereId === sphereId && s.ownerId === ownerId && s.state !== "deleted")
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map(clone);
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
