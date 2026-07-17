# RFC-020 — Audit trail view (governance chain observability)

## Status

Accepted

## Summary

Make the governance chain observable in the console. `event-model.md` promises that
from one `correlationId` an auditor can reconstruct *who asked, which policy version
decided, whether approval was required and by whom it was answered, what executed and
through which integration* — without reading private content. Today that chain is
recorded but effectively invisible: the only read surface is
`GET /audit/:correlationId`, which requires already knowing the id, and no UI shows
it. This RFC adds a Sphere-scoped recent-activity listing, links an approval to its
chain, and surfaces both in the console.

## Motivation

- **The promise is unverifiable in the product.** Correlation chaining is a headline
  guarantee (`event-model.md` §Correlation chaining, invariants "every sensitive
  action carries a correlation id chaining policy check → approval → runtime call →
  integration call"). Nothing in the console lets an administrator see it, so the
  guarantee cannot be inspected by the people it is for.
- **Approvals lack provenance.** The approvals panel (iteration 117/118) shows what
  is pending, but a granted approval vanishes from the inbox with no trace an admin
  can follow to what actually executed.
- **`api-contract.md` has no Audit APIs group.** The audit read surface grew
  ad-hoc (one undocumented route). This RFC defines it before it grows further.

## Proposal

### 1. Port: `AuditReader` gains a Sphere-scoped listing

```
interface AuditReader {
  byCorrelation(correlationId: string): readonly KinEvent[];
  // Most recent events for one Sphere, newest first, bounded.
  recentBySphere(sphereId: string, limit: number): readonly KinEvent[];
}
```

Implemented by `InMemoryAuditSink` (core, tests) and `SqliteAuditSink` (adapter,
indexed by sphere). Bounded by `limit` — an audit log is unbounded and a read must
never be able to pull all of it in one request.

### 2. API (new **Audit APIs** group in `api-contract.md`)

- **`GET /spheres/:id/audit?limit=`** — recent security facts for the Sphere, newest
  first. `limit` defaults to 50, capped at 200.
- **`GET /audit/:correlationId`** — the existing chain read, now documented.

Both return the `KinEvent` fields as recorded: ids, references, decision, deciding
policy id/version, user-safe reason, correlation id, timestamp. The projection copies
the event; it adds nothing and redacts nothing, because the event model already
guarantees the record itself carries no private content (that is the invariant — the
read surface is not the place to enforce it).

### 3. Approvals carry their correlation id

The `/approvals` projection exposes `correlationId`, so the console can link a
pending approval to its chain — the same id that will thread its execution.

### 4. Console

An **Activity** panel on the Sphere page lists recent events (type, decision, policy,
correlation id, time). Events are grouped by correlation id so a chain reads as one
action rather than loose rows. The approvals panel links each item to its chain.
The UI decides nothing — it renders already-governed, already-minimal facts.

## Domain impact

`AuditReader` (an existing core port) gains one bounded read method; `KinEvent` is
unchanged. No capability, policy, or memory concept changes. The audit *record* path
is untouched — this RFC only reads.

## Security and privacy impact

- **No new information is exposed.** The events surfaced are exactly what the sink
  already records, and `event-model.md` §"What an event may and may not carry"
  forbids conversation text, memory content, credentials and tokens from ever
  entering them. The view cannot leak what the record does not hold.
- **Audit minimality is a record-time invariant, not a view-time filter.** If a
  future event carried private content, the fix is the event, not this projection.
- **Bounded reads.** `limit` is capped; an audit read cannot drain the log.
- **Authorization is the known MVP gap, unchanged by this RFC.** `event-model.md`
  says events must be "safe to inspect by authorized administrators", but RFC-003
  explicitly defers real administrator authentication, so *every* read endpoint is
  currently ungated — audit included, both before and after this change. This RFC
  does not widen that gap (it adds no privileged data), but it does make the missing
  read authorization more consequential: recent-activity listing is a security
  surface, and it should be admin-gated the moment RFC-003's deferred auth lands.
  Tracked as an open question below, deliberately not solved here — inventing a
  bespoke auth check for one endpoint would contradict RFC-003's decision.

## Alternatives considered

- **Show the audit chain only inside the approvals panel.** Rejected — the chain
  exists for every sensitive action, not only approved ones; denials are exactly what
  an auditor most needs to see.
- **A global cross-Sphere activity feed.** Rejected for now — Sphere is the
  governance boundary; a cross-Sphere feed is a different (and more sensitive)
  surface deserving its own decision.
- **Unbounded listing.** Rejected — an audit log grows without limit.

## Open questions

- Admin-gating audit reads once RFC-003's deferred administrator auth lands (the
  read surface should require an authorized administrator per `event-model.md`).
- Retention/rotation of the audit log (out of scope here).
- Filtering by event type / decision, and pagination beyond a bounded tail.

## Acceptance criteria

- `AuditReader.recentBySphere` exists, is bounded, and is implemented by both the
  in-memory and SQLite sinks, with tests (including Sphere scoping and the limit).
- `GET /spheres/:id/audit` returns recent events newest-first, honours `limit`, and
  caps it; `GET /audit/:correlationId` returns the chain.
- The `/approvals` projection exposes `correlationId`.
- The Sphere page shows an Activity panel grouping events by correlation id; an
  approval links to its chain.
- `api-contract.md` documents the Audit APIs group.
