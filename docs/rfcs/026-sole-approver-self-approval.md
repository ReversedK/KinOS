# RFC-026 — Sole-approver self-approval

## Status

Accepted

## Summary

Permit the requester of an approval-gated action to approve it **only when they are
the single eligible approver in the Sphere**. Strict no-self-approval (separation of
duties) is preserved whenever two or more eligible approvers exist. This unblocks
single-admin Spheres — a *person* Sphere, or a one-parent family — where every
approval-floored action (e.g. `runtime.config.project`, `sphere.export`) is otherwise
permanently un-grantable.

## Motivation

`runtime.config.project` and other capabilities carry an approval floor, so even the
sole administrator's own request routes to approval. The core's no-self-approval rule
(hardened in RFC-021's fix) then blocks that admin from approving it — and in a Sphere
with one eligible approver, no one else *can*. The action is stuck forever. A user hit
exactly this: a one-member Sphere, `runtime.config.project` pending, every grant
returning "The requester cannot approve their own request".

Separation of duties is a control that requires **two** principals to mean anything.
With exactly one eligible approver, requiring a *different* approver is not a control —
it is an impossibility, and that lone admin already holds unilateral authority over the
Sphere (they set policy, invite members, deploy agents). Blocking their self-approval
protects nothing; it only disables approval-floored capabilities for the whole class
of single-admin Spheres, which the domain treats as first-class ("a person, family,
team, organization").

## Proposal

At grant time, compute whether the requester is the **sole eligible approver**:

```
eligible = active members whose role ∈ approval.approverRoles and who are adults
soleEligibleApprover = eligible.length == 1 and eligible[0] == requestedBy.onBehalfOf
```

Thread that boolean into `recordApprovalDecision` → `assertEligible`. The self-approval
check fires **only when it is false**:

- `|eligible| ≥ 2` → strict: the requester may not approve their own request (a second
  approver exists and must be used).
- `|eligible| == 1` and it is the requester → self-approval permitted.

The router computes `soleEligibleApprover` from the Sphere's members (it already loads
them) and passes it with the approver decision; the core enforces it.

**Explicitly unchanged:** the anonymous-requester guard (RFC-021) — a request with no
identified requester (`onBehalfOf` unset and `agentId == "unknown"`) is still refused.
The relaxation requires an *identified* sole approver, so it cannot reopen that hole.
Minors are still excluded; quorum, active-membership and role checks are unchanged.

## Domain impact

`RecordDecisionInput` / `ApproverDecisionInput` gain an optional
`soleEligibleApprover` (default `false` — strict). `assertEligible` takes the flag.
No new capability, policy, event, or entity. The default preserves today's strict
behavior for every caller that does not compute the flag.

## Security and privacy impact

- **Separation of duties preserved where it is real.** With ≥2 eligible approvers the
  requester still cannot self-approve — no weakening of the multi-admin case.
- **No new authority.** The sole admin could already do anything in their Sphere; this
  only lets them clear the approval they themselves raised. It grants nothing they did
  not already hold.
- **Anonymous-requester hole stays closed.** The relaxation is gated on an *identified*
  requester being the sole eligible approver; an unidentified requester is still
  refused (RFC-021, unchanged).
- **Deny-by-default intact.** The flag defaults false; only the router, computing it
  from real membership, can set it true.

## Alternatives considered

- **Keep strict; require inviting a second adult.** Rejected: it makes a *person*
  Sphere unable to ever use approval-floored capabilities — the domain says a Sphere
  can be one person.
- **Drop the approval floor on `runtime.config.project`.** Rejected as the general
  fix: it only unblocks that one capability, leaving export/etc. stuck for single-admin
  Spheres, and it weakens governance for multi-admin Spheres where the floor is wanted.
- **Let any requester self-approve.** Rejected — that is exactly the separation-of-
  duties violation this preserves for multi-approver Spheres, and it reopens RFC-021.

## Open questions

- Whether "sole eligible approver" should also require the approver to be active at
  grant time beyond membership status (today: active members only — sufficient).

## Acceptance criteria

- In a Sphere whose only eligible approver is the requester, that requester can grant
  their own approval-floored action; it executes.
- In a Sphere with ≥2 eligible approvers, the requester still cannot self-approve
  (unchanged 422 with the separation-of-duties reason).
- An unidentified requester is still refused (RFC-021 guard intact).
- The console shows the governed reason on any refused grant, not a bare status code.
