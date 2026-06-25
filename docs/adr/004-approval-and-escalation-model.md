# ADR-004 — Approval and Escalation Model

## Status

Draft — proposed. Pending acceptance.

## Context

The Policy Engine (`docs/adr/003-policy-engine.md`) produces three effects: `allow`, `deny` and `require_approval`. The `require_approval` effect is incomplete on its own — it names that a human must validate an action, but the lifecycle of that validation is currently described in fragments across ADR-003 (effect semantics, expiry-as-denial), `docs/domain/capability-catalog.md` (which capabilities require approval), `docs/architecture/api-contract.md` (approval APIs) and `docs/security/threat-model.md` (approval manipulation). No single document defines how an approval is created, who may answer it, how it expires and how it escalates.

The `ApprovalRequest` entity exists in `docs/domain/domain-model.md` but has no lifecycle in `docs/domain/entity-lifecycle.md`. This ADR closes that gap and is the authoritative home for approval and escalation behavior.

## Decision

KinOS treats human approval as a first-class, governed, auditable step that suspends an action until an authorized human resolves it. Approval is requested by the Policy Engine, answered by humans (never by an agent or model), threaded by a correlation id, and recorded as minimal audit facts.

## What raises an approval

An `ApprovalRequest` is created only when the Policy Engine returns `require_approval` for a specific action-authorization request. Approval is never raised by:

- an agent deciding it "should ask";
- a prompt instructing the model to seek confirmation;
- a runtime or integration.

The model may phrase the request to the user, but the obligation to approve originates from policy, not from the model. This keeps the invariant "policies do not live in prompts" intact.

## Request model

```ts
type ApprovalRequest = {
  id: string;
  sphereId: string;
  correlationId: string;        // same id as the originating policy check
  requestedBy: {
    agentId: string;
    onBehalfOf?: string;        // memberId the agent represents
  };
  action: {
    capabilityName: string;     // e.g. payment.execute
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    summary: string;            // user-safe description, not private content
    payloadRef?: string;        // reference to the pending action, not its body
  };
  matchedPolicyId: string;
  matchedPolicyVersion: number;
  approverRoles: string[];      // roles permitted to answer, from the policy decision
  quorum: number;               // approvals required to grant (default 1)
  state: 'pending' | 'granted' | 'denied' | 'expired' | 'cancelled';
  decisions: Array<{
    approverMemberId: string;
    decision: 'grant' | 'deny';
    at: string;                 // ISO timestamp
    reason?: string;
  }>;
  createdAt: string;
  expiresAt: string;
};
```

The pending action is referenced, not copied, into the approval. An approval record carries enough to decide responsibly (who, which capability, what risk, a safe summary) and no more (no private memory content, no message bodies). See `docs/security/privacy-model.md`.

## Who may approve

Approver eligibility comes from the policy decision's `approverRoles`, resolved against the Sphere's current membership:

- the approver must be an active Member of the Sphere holding one of `approverRoles`;
- for actions by or about a **minor**, eligible approvers default to the minor's parents/guardians or Sphere admins, never the minor;
- **separation of duties:** the subject who requested the action cannot approve their own request, and an agent can never approve. A human always answers.

If no eligible approver exists in the Sphere, the request cannot be granted and resolves as a denial when it expires (fail closed). It is never auto-granted for lack of an approver.

## Quorum

`quorum` is the number of distinct eligible approvers whose `grant` is required (default 1). A single `deny` from any eligible approver resolves the whole request as `denied` — deny dominates, consistent with the Policy Engine precedence. Duplicate decisions by the same approver do not count twice.

## Lifecycle

```text
pending ──grant (quorum met)──> granted
pending ──deny (any approver)─> denied
pending ──timeout────────────> expired   (resolves as denial)
pending ──originator cancels──> cancelled (action withdrawn before resolution)
```

- **pending** — created; the action is suspended and does not run.
- **granted** — quorum of grants reached; the action becomes authorized to proceed under the same correlation id. A grant authorizes only this specific action, once.
- **denied** — an eligible approver denied, or quorum became unreachable. Terminal.
- **expired** — `expiresAt` passed with no resolution; resolves exactly as a denial. The action does not run.
- **cancelled** — the requesting subject/agent withdrew the action before resolution (e.g. the user abandoned the task). Terminal; not an authorization.

All transitions are terminal except out of `pending`. A granted approval is single-use: it does not authorize future equivalent actions, which must be evaluated and, if needed, approved again.

## Expiry

Every approval has an `expiresAt`. Expiry is a denial, not a soft pass. Default expiry windows scale with risk and are Sphere-configurable; higher risk should not silently get a longer window. A re-request after expiry is a new `ApprovalRequest` with a new id, chained by a new correlation id.

## Escalation

Escalation changes *who* is asked or *what* is required, never the fail-closed default:

- **risk escalation** — `critical` actions may require a higher `quorum` or a stricter approver role (e.g. a Sphere admin in addition to a parent).
- **minor-safety escalation** — actions by minors that touch external transfer, purchase, publication or contact with strangers escalate to parent/guardian approval by default, regardless of the child's other permissions.
- **timeout escalation (optional)** — a Sphere may configure a pending request to notify additional approvers as expiry approaches. Escalation may widen the approver set; it must never narrow it to zero or convert a pending request into an automatic grant.

Escalation never downgrades an effect. It cannot turn `require_approval` into `allow`.

## Correlation and audit

The approval shares the originating request's `correlationId`, so the full chain is reconstructable:

```text
policy check (require_approval) -> approval request -> approval decision
  -> runtime call -> integration call -> audit events
```

Audit records the security facts of each transition (requested, granted by whom, denied, expired, cancelled) and the deciding policy id/version — not the private content of the action. Approval events follow `docs/architecture/event-model.md` (e.g. `ApprovalRequested`, `ApprovalGranted`, `ApprovalDenied`, `ApprovalExpired`).

## Acceptance criteria

The model is satisfied when:

- a `require_approval` decision creates exactly one `ApprovalRequest` carrying the originating correlation id;
- only active Members holding an `approverRoles` role can answer, and the requesting subject and any agent are excluded;
- a minor can never approve an action by or about themselves;
- one `deny` resolves the request as denied; `quorum` grants are required to grant;
- an unanswered request expires and resolves as a denial, and the action does not run;
- a granted approval authorizes only the single pending action and is not reusable;
- every transition emits a minimal audit event sharing the correlation id, with no private content in the payload.

## Consequences

- `require_approval` becomes fully specified end to end; the runtime never proceeds on an unresolved or expired approval.
- Approvals fail closed: no eligible approver, expiry, or ambiguity all resolve to denial.
- Humans remain the final authority for sensitive actions; agents and models never self-approve.
- Approval records are governed and minimal, so the audit trail does not become a private-data leak.
- `docs/domain/entity-lifecycle.md` gains the Approval Request lifecycle; `docs/domain/domain-model.md`, ADR-003 and the API contract remain consistent with this model.
