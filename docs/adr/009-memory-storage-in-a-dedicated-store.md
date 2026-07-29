# ADR-009 — Canonical memory persists in a dedicated store, not the Sphere snapshot

## Status

Accepted. Realizes RFC-044. Refines the storage of ADR-002 canonical memory; the
memory *model* (ADR-002) is unchanged.

## Context

ADR-002 makes the Memory Item canonical and derived indexes regenerable. It does not
prescribe *where* memory is persisted. The MVP put every Sphere's memory inside the
Sphere export snapshot (`spheres.snapshot.memory[]`), stored as one JSON blob per
Sphere via `SphereStore`. Consequences:

- Every `memory.capture`/`share`/`revoke` reloads, re-serializes and rewrites the
  **entire** Sphere blob (members, policies, agents, integrations, packages, and all
  memory) — write cost is O(whole Sphere) per memory op.
- Every `memory.search` / `document.search` parses the whole snapshot and scans all
  items in process — no index, no server-side filter.
- Memory writes serialize on the single Sphere row, contending with unrelated Sphere
  writes.

`CalendarStore` already set the precedent: calendar events live in their own
`SqliteCalendarStore` (`data/calendar.sqlite`), keyed by `sphere_id`, outside the
snapshot. Memory — higher-volume than calendar — is the natural next store to split.

Constraint from RFC-021 (export/portability): a Sphere backup **must** include memory
("a backup that drops them cannot restore the Sphere"). So memory may move off the
Sphere blob, but must remain part of export/restore.

## Decision

Persist canonical memory in a **dedicated store behind a `MemoryStore` port**, with a
`SqliteMemoryStore` adapter backed by an indexed `memory` table — separate from the
Sphere snapshot, the calendar store, and the audit log. Governance-relevant fields
(sphere, owner, owner type, visibility, state, updated-at) are indexed columns; the
full Memory Item is stored as JSON (the canonical source of truth; embeddings remain
derived and are not stored here).

Boundaries this preserves:

- **The Memory Item model is unchanged** (ADR-002): canonical item, derived indexes.
  Only the persistence location changes.
- **Policy-scoped read is unchanged.** Handlers read `memoryStore.listBySphere(id)`
  and pass it through the existing `resolveReadableMemory` resolver; who-can-read is
  decided exactly as before.
- **Export/restore stays complete (RFC-021).** The export *format* still carries
  `memory[]`; the export path reads it from the MemoryStore and the restore path
  writes it back into the MemoryStore. A round-trip loses nothing. The Sphere snapshot
  no longer carries memory.
- **Sphere isolation is the query boundary.** Every row is keyed by `sphere_id`;
  reads are always Sphere-scoped, from the governed ExecutionContext.
- **No provider leak into the core.** `MemoryStore` is a pure-domain port (like
  `CalendarStore`/`SphereStore`); the SQLite implementation is an adapter outside the
  core.

Existing memory embedded in `spheres.snapshot.memory[]` is migrated into the new
table with no data loss, idempotently, and cleared from the blob.

## Consequences

- `memory.capture` becomes a single-row insert; memory writes no longer rewrite the
  Sphere and no longer contend with unrelated Sphere writes.
- `memory.search` reads Sphere-scoped indexed rows; server-side/indexed and later
  vector search become possible behind the same port (additive follow-up, RFC-044
  Open questions).
- One more local SQLite file (`data/memory.sqlite`, `KINOS_MEMORY_DB`), consistent
  with calendar/audit/session stores; memory scales and backs up independently.
- Restore and per-Sphere delete are explicit store operations (`deleteBySphere`),
  aligning with archival/erasure; revocation still blocks the future while retaining
  the grant as an audit fact (invariant 5).

## Alternatives considered

Keeping memory in the snapshot with smarter serialization (still O(Sphere) per op,
un-indexable); a `memory` table inside the existing Sphere DB rather than a separate
file (acceptable — the port hides it; a separate file matches precedent); dropping
memory from the export like calendar (rejected — RFC-021 requires it in the backup).
See RFC-044 for the full comparison.
