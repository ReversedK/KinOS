# RFC-044 — A dedicated, indexed memory store

## Status

Accepted

## Summary

Canonical memory currently lives inside the Sphere snapshot JSON
(`spheres.snapshot.memory[]`), so **every** `memory.capture`/`share`/`revoke`
rewrites the entire Sphere blob (`INSERT OR REPLACE` of the whole snapshot), and
every `memory.search` deserializes all of it. This is simple and correct for the MVP
but does not scale — cost is O(whole Sphere) per memory write, and search is a full
in-memory scan. Move memory to a **dedicated, indexed store** behind a `MemoryStore`
port with a `SqliteMemoryStore` adapter (a `memory` table), following the existing
`CalendarStore` precedent (calendar events already live outside the snapshot). Memory
stays canonical and governed, stays policy-scoped on read, and stays included in
export/restore (RFC-021) — only its on-disk home changes, from a JSON array in the
Sphere blob to indexed rows.

## Motivation

- **Write cost.** A single `memory.capture` today loads the Sphere, appends one item,
  re-serializes the *entire* Sphere (members, policies, agents, integrations,
  packages, all memory…) and rewrites the row. For a Sphere with many notes this is
  increasingly expensive and contends with every other Sphere write.
- **Read cost.** `memory.search` (and `document.search`) parse the whole snapshot and
  scan all items in memory each call. No index, no server-side filter.
- **Concurrency.** Two governed actions that both touch the Sphere serialize on the
  one snapshot row; memory writes should not block unrelated Sphere writes.
- **Precedent exists.** `CalendarStore` already keeps events in a separate
  `SqliteCalendarStore` (`data/calendar.sqlite`), out of the snapshot. Memory is the
  natural next store to split out; it is higher-volume than calendar.

## Proposal

### Port (core)

A `MemoryStore` port (pure domain interface, like `CalendarStore`/`SphereStore`):

```
interface MemoryStore {
  append(item: MemoryItem): Promise<void>;
  get(sphereId: string, id: string): Promise<MemoryItem | undefined>;
  replace(item: MemoryItem): Promise<void>;          // share / revoke / lifecycle updates
  listBySphere(sphereId: string): Promise<readonly MemoryItem[]>;
  deleteBySphere(sphereId: string): Promise<void>;   // restore-overwrite / hard delete
}
```

`replace` (not a generic upsert) keeps update intent explicit; ids are caller-supplied
(core stays deterministic). No query DSL yet — `listBySphere` returns the Sphere's
items and the existing `resolveReadableMemory` resolver still does policy-scoped
filtering. (Server-side/indexed query and vector search are a later, additive step;
see Open questions.)

### Adapter (persistence-sqlite)

`SqliteMemoryStore` with a dedicated table:

```
CREATE TABLE memory (
  id         TEXT PRIMARY KEY,
  sphere_id  TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  state      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  item       TEXT NOT NULL          -- the full MemoryItem JSON (canonical)
);
CREATE INDEX memory_sphere_state ON memory (sphere_id, state);
CREATE INDEX memory_sphere_owner ON memory (sphere_id, owner_id);
```

The governance-relevant fields are columns (for indexing/filtering); the full item is
JSON (canonical source of truth — embeddings are still derived and not stored here).
Default file `data/memory.sqlite` (env `KINOS_MEMORY_DB`), matching the other stores.

### Handlers

`local.memory_capture/search/share/revoke`, `local.sphere_note_create`, and the
documents source (`searchSharedDocuments`/`summarizeSharedDocument`) take a
`MemoryStore` and use it instead of `imported.memory`:

- capture/note → `memory.append(item)` (one row, no Sphere rewrite);
- search/documents → `resolveReadableMemory(subject, await memory.listBySphere(id), policies, …)`;
- share/revoke → `get` + `replace` the single item.

The Sphere snapshot is no longer touched by a memory write.

### Export / restore (RFC-021) — memory stays in the backup

The export FORMAT is unchanged: `SphereExport.memory[]` still carries every item, so a
backup remains complete ("a backup that drops memory cannot restore the Sphere").
Only the *source* changes:

- `exportSphere` (backup path) reads `memory` from `memory.listBySphere(sphereId)`
  and includes it in the snapshot.
- `importSphere` / `sphere.restore` writes the snapshot's `memory[]` into the
  `MemoryStore` (`deleteBySphere` then `append` each), not into the Sphere blob.

The pure-core `exportSphere`/`importSphere` shape is unchanged (they still accept and
return `memory[]`); the app layer wires the MemoryStore as the source/sink. The
Sphere blob (`spheres.snapshot`) stops carrying memory.

### Migration (no data loss)

On adapter open (or lazily on first Sphere load), a one-time migration copies any
`spheres.snapshot.memory[]` still embedded in the Sphere blob into the `memory` table
and clears it from the blob. Idempotent and lineage-safe: a Sphere whose memory is
already migrated (blob memory empty) is untouched. Existing SQLite files upgrade in
place; nothing is lost.

## Domain impact

New `MemoryStore` port (core) + `SqliteMemoryStore` adapter. `MemoryItem`, the
resolver, capabilities, floors, and the export *format* are unchanged. The Sphere
snapshot no longer stores memory (a storage-location change, not a model change).
Handlers and export/import wiring updated to use the MemoryStore.

## Security and privacy impact

- **No governance change.** Memory is still canonical, policy-scoped on read
  (`resolveReadableMemory` unchanged), private-by-default, audited as security facts
  not content (§18). Splitting the storage does not change who can read what.
- **Still local-first and portable.** A separate SQLite file in the same local data
  volume; memory is still fully included in export/restore, so backups stay complete
  and a restore reproduces every item.
- **Isolation preserved.** Rows are keyed by `sphere_id`; a query is always
  Sphere-scoped, and the subject/owner checks are unchanged. No cross-Sphere read is
  introduced.
- **Deletion/retention.** `deleteBySphere` gives a clean hard-delete/restore-overwrite
  path (RFC-022 restore never overwrites a *different* Sphere; per-Sphere delete
  aligns with archival/erasure). Revocation still blocks the future while the grant
  record is retained as an audit fact (invariant 5) — unchanged.

## Alternatives considered

- **Keep memory in the snapshot; optimize serialization.** Rejected — any in-blob
  scheme still rewrites/parses O(Sphere) per memory op and can't be indexed; it only
  delays the ceiling.
- **A `memory` table inside the existing `kinos.sqlite` Sphere DB.** Reasonable, but a
  separate file (`data/memory.sqlite`) matches the calendar/audit/session precedent,
  keeps the Sphere DB small, and lets memory scale/back up independently. Either is
  acceptable; the port abstracts it, so this is an adapter detail.
- **Full-text / vector search now.** Deferred — this RFC is the storage split (the
  scaling prerequisite). FTS5 or an embedding index is an additive follow-up behind
  the same port, once memory is indexed rows.
- **Drop memory from the export (like calendar).** Rejected — RFC-021 requires memory
  in the backup ("a backup that drops them cannot restore the Sphere"); calendar's
  exclusion is a separate, deliberate choice that does not apply to canonical memory.

## Open questions

- **Indexed/vector search.** Once memory is rows, `memory.search`/`document.search`
  can push filtering into SQL (LIKE/FTS) and later add a derived embedding index for
  semantic recall. A follow-up RFC; the `MemoryStore` port can gain a `search(query,
  scopeHints)` method without touching handlers' governance.
- **Per-agent memory namespace.** Independent of this RFC (still deferred from
  RFC-043): if memory gains `ownerType: "agent"`, the same store handles it (an extra
  indexed column), no schema redesign.

## Acceptance criteria

- Memory is stored in a dedicated indexed `memory` table via a `MemoryStore` port; a
  `memory.capture` performs a single-row insert and does not rewrite the Sphere blob.
- `memory.search` / `document.search` read from the MemoryStore and remain
  policy-scoped (identical results to today for the same data).
- Export includes every memory item (RFC-021) and restore reproduces them into the
  MemoryStore; a round-trip loses nothing.
- Existing memory embedded in `spheres.snapshot.memory[]` is migrated into the new
  table with no data loss, idempotently.
- Sphere isolation, private-by-default, minor floors, and audit minimality are
  unchanged.
- Verified live: capture on a large Sphere no longer rewrites the whole snapshot;
  search/recall and export/restore work end to end.
