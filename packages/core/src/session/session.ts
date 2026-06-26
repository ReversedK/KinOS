/**
 * Chat Session + Message (RFC-005, domain-model.md).
 *
 * A Session is a conversation between a member and an agent, holding the running
 * transcript for continuity. It is distinct from canonical MemoryItems (ADR-002)
 * and from AuditEvents (event-model): the transcript is private conversational
 * content, never the audit log, and never canonical memory — promoting a fact to
 * long-term memory is a separate, explicit, governed action.
 *
 * Pure domain: no I/O, no provider/runtime imports. Owner-private by default;
 * policy-scoped read is layered on by the resolver (a later slice), mirroring the
 * memory model. Immutable: every function returns a new value.
 */

/** Conversational role only — never an authorization role (coding principle 2). */
export type MessageRole = "user" | "agent";

export type SessionState = "active" | "archived" | "deleted";

export interface Message {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  /** Conversational content; private (never copied into audit). */
  readonly content: string;
  readonly createdAt: string;
  /** Links to any capability calls made during the turn. */
  readonly correlationId?: string;
}

export interface Session {
  readonly id: string;
  readonly sphereId: string;
  readonly agentId: string;
  /** The acting member who owns this conversation. */
  readonly ownerId: string;
  readonly title: string;
  readonly state: SessionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly Message[];
}

export interface CreateSessionInput {
  readonly id: string;
  readonly sphereId: string;
  readonly agentId: string;
  readonly ownerId: string;
  readonly title?: string;
  readonly now: string;
}

export function createSession(input: CreateSessionInput): Session {
  const title = (input.title ?? "").trim() || "New conversation";
  return {
    id: input.id,
    sphereId: input.sphereId,
    agentId: input.agentId,
    ownerId: input.ownerId,
    title,
    state: "active",
    createdAt: input.now,
    updatedAt: input.now,
    messages: [],
  };
}

export interface AppendMessageInput {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly now: string;
  readonly correlationId?: string;
}

/** Append a turn. Only an active session accepts messages (deny by default). */
export function appendMessage(session: Session, input: AppendMessageInput): Session {
  if (session.state !== "active") {
    throw new Error(`Cannot append to a ${session.state} session`);
  }
  const message: Message = {
    id: input.id,
    sessionId: session.id,
    role: input.role,
    content: input.content,
    createdAt: input.now,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
  };
  return { ...session, messages: [...session.messages, message], updatedAt: input.now };
}

/** Archive a session: kept and resumable, not surfaced by default. */
export function archiveSession(session: Session, now: string): Session {
  return { ...session, state: "archived", updatedAt: now };
}

/**
 * Delete a session: blocks future use and clears the transcript. Promoted
 * MemoryItems and audit facts are unaffected (deletion blocks the future, not the
 * past — invariant 5); those live outside the Session.
 */
export function deleteSession(session: Session, now: string): Session {
  return { ...session, state: "deleted", updatedAt: now, messages: [] };
}

/** Structural owner check. Policy-scoped read is layered on by the resolver. */
export function isOwnedBy(session: Session, memberId: string): boolean {
  return session.ownerId === memberId;
}
