# RFC-047 — An administrator may self-approve their own approval-floored actions

## Status

Accepted

## Summary

Some capabilities carry an approval floor (`sphere.export`, `runtime.enable_cloud`,
`runtime.config.project`, `runtime.session.restore`, `payment.execute`,
`native.browser`). Today, even the administrator who *initiates* one must file a
request and have it granted — and in a single-admin Sphere that is a pointless
two-step self-grant (RFC-026 already permits the self-approval, but as a separate
round-trip). This RFC makes the general rule explicit: **an administrator is the
human final authority (invariant 18); they do not need a second person to approve
their own administrative action.** When an eligible admin *member* is the requester,
the approval-floored capability executes immediately. The floor is unchanged for
everyone and everything else — most importantly, an **agent** requester never
self-approves, so agent-initiated floors still require a human.

## Motivation

Observed (PO): "I want to act as admin and skip approvals. As a general rule an admin
should not have to ask for approval, since they are the admin." No invariant mandates
separation of duties: approval floors are a design choice (RFC-026 + the catalog
`approvalFloor`). The invariant that *does* bear on this is #18 (humans remain final
authority) — and the admin *is* that human. The two-person value of an approval floor
is to put a **human** in the loop for a powerful **agent** action, not to make an
administrator ask permission of themselves. The friction (request → grant, even when
sole admin) added nothing but clicks.

## Proposal

At the governed execute path, when `beginSensitiveAction` returns `pending_approval`
and the **requester is an eligible admin member**, the server immediately records
that member's grant and runs the action — one call, one executed outcome — instead of
parking a pending approval.

"Eligible admin member" (all required):

- The subject is a **member**, not an agent: `subject.agentId` is absent and
  `subject.memberId` identifies an active member of the Sphere.
- That member is **adult** (`effectiveAgeProfile === "adult"`) and holds one of the
  action's **approver roles** — the same eligibility any approver must meet.

If the requester is not an eligible admin member (a non-admin member, a minor, or —
crucially — an **agent**), nothing changes: the approval is saved and awaits a human
approver exactly as before.

Per the PO decision, this applies to **all** approval-floored capabilities,
including `sphere.export`. An administrator may therefore export the Sphere (a
snapshot that contains other members' private memory) without a second approver.

### Why an agent can never self-approve

The eligibility check keys on a **member** subject with no `agentId`. An agent —
even one owned by an admin — carries an `agentId`, so it fails the check and its
approval-floored calls (`payment.execute`, `native.browser`, …) still route to a
human approver. This preserves invariants 18 and 21 for the case they exist for:
a human decides an agent's high-stakes real-world or external action.

## Domain impact

App-layer only. The router's execute path gains the admin-self-approval shortcut,
reusing the existing `resolveApproval` with the requester as approver (the RFC-026
`soleEligibleApprover` bypass generalised to "an admin may approve their own
request"). No change to the catalog, the Policy Engine, the approval domain model,
events, or entities. The `approvalFloor` remains on the catalog capabilities — it
still governs every non-admin and every agent requester.

## Security and privacy impact

- **Full audit chain intact (invariant 15).** The action is still recorded as
  `approval.requested` → `approval.granted` (by the admin) → `capability.executed`,
  with the correlation id. Self-approval is a recorded fact, not a silent bypass.
- **Agents unaffected (invariants 18/21).** Agent-initiated approval floors still
  require a human; an admin's agent cannot approve its own payment or browser use.
- **Minors unaffected (invariant 8).** A minor is never an eligible approver, so a
  minor requester still cannot self-approve.
- **Deny-by-default preserved.** A non-admin member's approval-floored request still
  parks for a human; nothing is auto-approved for a subject lacking an approver role.
- **Accepted residual risk (invariant 21).** Including `sphere.export` means a single
  compromised or rogue administrator can export other members' private memory without
  a second principal. This is a conscious PO trade-off recorded here; it can be
  narrowed later by marking specific capabilities as requiring a distinct second
  approver without reworking this mechanism.

## Alternatives considered

- **Keep `sphere.export` two-person (separation of duties for other members' data).**
  Recommended on invariant-21 grounds; the PO chose the simpler uniform rule. The
  mechanism leaves room to reintroduce a per-capability "second approver required"
  flag if that trade-off is revisited.
- **A per-Sphere "admins bypass approvals" toggle.** Rejected as unnecessary
  configuration (invariant 22, simplicity): the general rule is the desired default,
  and the agent carve-out is structural, not configurable.
- **Remove the approval floors from the catalog.** Rejected: that would also drop the
  human-in-the-loop for agent-initiated actions, which the floors exist to provide.

## Acceptance criteria

- An admin member requesting `runtime.enable_cloud` / `runtime.config.project` /
  `sphere.export` gets an immediate `executed` outcome (no pending approval), with the
  full requested → granted → executed audit chain recorded.
- A non-admin member requesting the same capability still gets `pending_approval`.
- An **agent** requesting `payment.execute` / `native.browser` still gets
  `pending_approval` — never auto-approved, even when its owner is an admin.
- A minor requesting an approval-floored capability is denied (catalog profile floor)
  and never self-approves.
