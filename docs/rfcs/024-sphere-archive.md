# RFC-024 — Sphere archive (governed, soft, reversible)

## Status

Accepted

## Summary

Add `sphere.archive`: a governed capability that sets a Sphere's status to
`archived` (and back to `active`), and hide archived Spheres from the console list by
default. This fills a real gap — `api-contract.md` lists "archive Sphere" as a Sphere
API, the domain `SphereStatus` already includes `archived`, and the store can delete,
but nothing governed lets an operator remove a Sphere from view. You could create and
restore Spheres but never retire one.

Archive is **soft and reversible**: it flips a status, keeps all data and audit, and
can be undone. It is not deletion.

## Motivation

- A console that accumulates Spheres with no way to retire them is unusable over time
  (the immediate trigger: 26 test Spheres cluttering the list).
- The capability is already implied by the contract and the status enum; only the
  governed action and the list filter are missing.
- **Invariant-aligned**: KinOS never casually destroys user data (invariant 1). The
  right primitive is a reversible archive that preserves the record — not a hard
  delete. Past facts remain as audit; a mistaken archive is undone by restoring.

## Proposal

- **Capability** `sphere.archive` in the catalog: `risk: "high"`,
  `allowedProfiles: ["adult"]`, `approvalFloor: false`. No floor because it is
  reversible and destroys nothing — the same posture as `integration.disable` /
  `package.disable`. A Sphere that wants a stricter rule can add a policy.
- **Input** `{ archived: boolean }` — `true` archives, `false` restores to active.
  One capability covers both directions.
- **Domain** helpers `archiveSphere(sphere)` / `unarchiveSphere(sphere)` (pure): set
  the status with a guard (a `deleted` Sphere cannot be archived; only an `archived`
  Sphere restores). No other entity change.
- **Authorization**: granted to administrators via the existing admin-settings seed
  (`IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES`), with the same lineage-anchored,
  version-guarded backfill used for `sphere.export` (RFC-021) so existing Spheres
  gain it without overwriting an admin's edited policy. Deny-by-default otherwise.
- **Audit**: a new event type `sphere.archived`, recorded with the Sphere id and a
  user-safe reason distinguishing archive from restore. No content, ever.
- **Console**: the Spheres list hides `archived` Spheres by default, with a "show
  archived" toggle. The Settings section gains an Archive / Restore control.

## Domain impact

One new capability, one new `KinEventType` (`sphere.archived`, documented in
`event-model.md`), and two pure status helpers. No memory or policy semantics change;
`SphereStatus.archived` already existed.

## Security and privacy impact

- **Deny by default**: non-adults are denied by the catalog profile floor; only the
  admin-settings seed authorizes it, and only for administrators.
- **Reversible, non-destructive**: archive preserves all data and audit; it is a
  status flip, undone by restore. No hard delete is introduced here.
- **Governed like any capability**: runs through the pipeline; the UI triggers and
  decides nothing (coding principle 1). The action is an audited fact.
- **Availability, not confidentiality**: hiding an archived Sphere from the list is a
  view concern; it changes no one's access rights. An archived Sphere is still
  policy-governed if reached directly.

## Alternatives considered

- **Hard delete.** Rejected as the default: it destroys data and audit, against
  invariant 1. A separate, heavily-guarded `sphere.delete` (with
  `deletion_requested` → `deleted`) can come later if a genuine erasure need arises;
  archive covers "retire from view" without that risk.
- **Approval-floored archive.** Rejected: it is reversible and destroys nothing, so a
  floor adds friction without protecting anything — and would make batch-retiring
  single-member Spheres impossible (no second approver).
- **A server-side "list only active" endpoint.** Deferred: the list already fetches
  summaries carrying `status`; filtering in the client keeps the API unchanged and
  lets the toggle reveal archived without a second call.

## Open questions

- A guarded hard `sphere.delete` for genuine erasure (right-to-be-forgotten), with
  its own stricter gate. Out of scope here.
- Bulk archive/restore from the console (this RFC exposes single-Sphere controls; the
  test-data cleanup batches through the governed endpoint directly).

## Acceptance criteria

- `sphere.archive` exists: high, adult-only, no floor; authorized via the
  admin-settings seed (with backfill for existing Spheres).
- Executing it with `{ archived: true }` sets status `archived`; `{ archived: false }`
  restores `active`; a child is denied; a non-admin is denied by default.
- `sphere.archived` is audited; no snapshot/content enters audit.
- The Spheres list hides archived Spheres by default and can reveal them.
- Verified end-to-end against the running stack, and the 26 test Spheres are cleared
  through this governed capability.
