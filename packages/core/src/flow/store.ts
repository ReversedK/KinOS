/**
 * Persistence port for suspended sensitive actions (ADR-004 + ADR-006).
 *
 * When a capability execution returns require_approval, the ApprovalRequest and
 * the originating request are persisted together as a PendingSensitiveAction so
 * the suspend → grant → execute loop can span processes: a later `approve`
 * step loads it, records the human decision, and (on grant) resumes the one
 * authorized execution.
 *
 * Pure domain: the interface plus an in-memory reference. Durable adapters
 * (SQLite) implement the same contract outside the core.
 */

import type { ApprovalRequest } from "../approval/approval.js";
import type { CapabilityExecutionRequest } from "../capability/resolver.js";

export interface PendingSensitiveAction {
  readonly approval: ApprovalRequest;
  /** Enough to resume the one authorized execution on grant. */
  readonly request: CapabilityExecutionRequest;
}

export interface ApprovalStore {
  /** Persist a pending action, keyed by its approval id (overwrites). */
  save(pending: PendingSensitiveAction): Promise<void>;
  load(approvalId: string): Promise<PendingSensitiveAction | undefined>;
  /** Actions whose approval is still pending, optionally filtered by Sphere. */
  listPending(sphereId?: string): Promise<readonly PendingSensitiveAction[]>;
  delete(approvalId: string): Promise<void>;
}

function clone(p: PendingSensitiveAction): PendingSensitiveAction {
  return JSON.parse(JSON.stringify(p)) as PendingSensitiveAction;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly byId = new Map<string, PendingSensitiveAction>();

  async save(pending: PendingSensitiveAction): Promise<void> {
    this.byId.set(pending.approval.id, clone(pending));
  }

  async load(approvalId: string): Promise<PendingSensitiveAction | undefined> {
    const found = this.byId.get(approvalId);
    return found === undefined ? undefined : clone(found);
  }

  async listPending(sphereId?: string): Promise<readonly PendingSensitiveAction[]> {
    return [...this.byId.values()]
      .filter(
        (p) =>
          p.approval.state === "pending" &&
          (sphereId === undefined || p.approval.sphereId === sphereId),
      )
      .map(clone);
  }

  async delete(approvalId: string): Promise<void> {
    this.byId.delete(approvalId);
  }
}
