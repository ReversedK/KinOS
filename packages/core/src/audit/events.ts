/**
 * Audit events (event-model.md).
 *
 * Events are minimal security facts, never conversations. They carry ids,
 * references, decision class, deciding policy and a correlation id — never full
 * content, message bodies, memory content, credentials or secrets. A single
 * sensitive action produces a chain of events sharing one correlationId.
 *
 * Pure domain: the types, an AuditSink port, and an in-memory recorder for
 * tests/ephemeral runs. Durable audit logs are adapters outside the core.
 */

export type KinEventType =
  | "sphere.created"
  | "identity.impersonated"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "agent.created"
  | "agent.updated"
  | "agent.disabled"
  | "memory.created"
  | "memory.shared"
  | "memory.revoked"
  | "memory.deleted"
  | "policy.created"
  | "policy.activated"
  | "policy.disabled"
  | "capability.requested"
  | "capability.allowed"
  | "capability.denied"
  | "capability.executed"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "integration.enabled"
  | "integration.disabled"
  | "package.installed"
  | "package.enabled"
  | "package.disabled"
  | "package.uninstalled"
  | "runtime.token.provisioned"
  | "runtime.token.rotated"
  | "runtime.token.revoked"
  | "runtime.session.backed_up"
  | "runtime.session.restored"
  /** A terminal was attached to an agent's governed Harness profile (ADR-008 §6). */
  | "runtime.session.attached"
  /** An integration was configured — provider/scopes set, credentials by reference (RFC-016). */
  | "integration.configured"
  /** An OAuth integration connect was begun / completed (RFC-017); never the token. */
  | "integration.oauth.begun"
  | "integration.oauth.connected"
  | "external_transfer.requested"
  | "external_transfer.allowed"
  | "external_transfer.denied";

export type EventDecision = "allow" | "deny" | "require_approval" | "executed" | "failed";

export interface KinEvent {
  readonly id: string;
  readonly type: KinEventType;
  readonly sphereId: string;
  readonly actorId?: string;
  readonly agentId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly decision?: EventDecision;
  /** User-safe: names the policy and decision class, never private content. */
  readonly reason?: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

/** A draft event without its id; the sink assigns the id on record. */
export type KinEventDraft = Omit<KinEvent, "id">;

/**
 * Port for recording audit events. Adapters provide durable implementations;
 * this module ships an in-memory recorder.
 */
export interface AuditSink {
  record(event: KinEventDraft): void;
}

/** Read side of the audit log: reconstruct a single action's event chain. */
export interface AuditReader {
  byCorrelation(correlationId: string): readonly KinEvent[];
}

export class InMemoryAuditSink implements AuditSink, AuditReader {
  private seq = 0;
  readonly events: KinEvent[] = [];

  record(event: KinEventDraft): void {
    this.seq += 1;
    this.events.push({ id: `evt_${this.seq}`, ...event });
  }

  byCorrelation(correlationId: string): readonly KinEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }
}
