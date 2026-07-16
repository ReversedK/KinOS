# RFC-015 — Memory share revocation

## Status

Accepted (2026-07-16)

## Summary

Complete the notes story (RFC-013) with revocation: a new `memory.revoke_share`
capability that withdraws a member's share of a note. It demonstrates a standing
invariant end to end — **revocation blocks the future, not the past**: the shared
member loses access going forward, while the grant record is retained (marked
revoked) as an audit fact.

## Motivation

RFC-013 added capture / search / share. Sharing widens access; nothing narrows it
again. KinOS's contract is explicit that access is "revocable by default" and that
"revocation blocks future access while past access stays as audit facts". The
domain already has `revokeShare` (it sets `revokedAt` on the grant and leaves the
record in place) and `hasActiveGrant` (which the resolver consults). This RFC
exposes that through a governed capability so revocation is a real, testable
product action, not just a domain function.

## Proposal

- **New capability `memory.revoke_share`** (risk medium, profiles adult + teen, no
  approval floor — a safety action should be low-friction). `family-notes` provides
  it, binds it to a handler, and its default grant lets adults revoke.
- **Handler** (`local.memory_revoke`): load the Sphere, find the item, apply
  `revokeShare(item, { subjectId, now })`, save. Input `{ itemId, memberId }`.
- **Owner-only**: only the item's owner may revoke a share of it. The handler takes
  the owner identity from the governed `ExecutionContext` (`context.subject`) and
  refuses if the acting subject is not the owner — a non-owner cannot strip another
  member's grants. Scope (Sphere) also comes from the context, never agent input.
- **Effect on visibility**: after revocation the shared member has no active grant,
  so `resolveReadableMemory` no longer surfaces the item to them (deny by default
  for `shared_with_members` without an active grant). The owner still sees it. The
  grant record remains with `revokedAt` set — the past is preserved.

## Domain impact

- New catalog capability `memory.revoke_share` (audit facts: actor, capability,
  decision, correlationId — never content).
- `family-notes` provides it (+ binding + adult grant preset).
- New `local.memory_revoke` handler (reuses the existing `revokeShare` domain fn).
- No change to `MemoryItem`, `revokeShare`/`hasActiveGrant`, the resolver, the
  Policy Engine, or the Sphere-MCP contract.

## Security and privacy impact

- **Revocation blocks the future, not the past** (invariant 5): access ends going
  forward; the grant stays as an audit fact (`revokedAt`), so who-had-access-when is
  never erased.
- **Owner-only**, scoped from the governed context: a member cannot revoke shares on
  another member's memory, and cannot reach another Sphere's memory.
- Governed and audited like every capability; the note content is never logged.

## Alternatives considered

- **Delete the grant record on revoke.** Rejected: it would erase the audit fact
  that access existed — the opposite of "past access stays as audit facts".
- **Let any adult with `memory.share` revoke any item.** Rejected: revocation of a
  share is an ownership action; a non-owner stripping grants is not the owner's
  intent. Owner-only is the safe default.

## Open questions

- Revoking a `shared_with_supervisors` / `shared_with_sphere` scope (this slice
  covers member grants).
- A member-facing "who can see this note" view and one-click revoke — a UI slice.
- Full memory forget/redact (erasing content while keeping audit refs) — a larger
  ADR-002 slice.

## Acceptance criteria

- `memory.revoke_share` withdraws a named member's share; a subsequent search by
  that member no longer returns the item, while the owner's search still does.
- The grant record is retained with `revokedAt` (past access preserved).
- Only the item owner may revoke; a non-owner is refused. Scope comes from the
  governed context.
