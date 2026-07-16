# RFC-013 — Real Canonical Memory: policy-scoped notes (capture / search / share)

## Status

Accepted (2026-07-16)

## Summary

Make the `family-notes` package real. Today `memory.search` / `memory.share`
are synthetic stubs, and there is no governed way to *put* a memory in. This RFC
wires the notes capabilities to KinOS's existing **canonical memory** — the
`MemoryItem` model, the `resolveReadableMemory` retrieval rule (ADR-002), and the
Sphere snapshot where memory already persists — and adds one capability,
`memory.capture`, so a member or agent can record a note through the governed
pipeline. The headline property, proven live: **memory retrieval is policy-scoped
per item** — an agent searching memory sees only what its subject is authorized to
read, never another member's private notes.

## Motivation

Canonical memory is the product's core ("memory is canonical; the model never
owns memory"). The retrieval rule already exists and is even used on the chat
path (`resolveReadableMemory`), but the store-facing capabilities behind the
`family-notes` package return fake data, so nothing demonstrates the rule end to
end through the governed tool loop. And there is no capability to create a memory
at all, so the store cannot be populated or tested. Both gaps are closed here,
reusing what exists rather than inventing a parallel memory.

## Proposal

### 1. `memory.capture` — a governed way to record a note

New catalog capability `memory.capture` (risk low, profiles adult + teen, no
approval floor): append a **private** `MemoryItem` owned by the acting subject to
the Sphere's canonical memory. Private by default (ADR-002) — a scope is never
widened by silence. `family-notes` provides it, binds it to a handler, and its
grant preset lets adults capture.

### 2. `memory.search` — real and policy-scoped

The handler loads the Sphere's memory items and policies, runs
`resolveReadableMemory(context.subject, items, policies, …)`, then applies an
optional query substring filter to the **already-authorized** result. The subject
and Sphere come from the governed `ExecutionContext` (RFC-012), never from agent
input. So an agent only ever sees memory its subject may read: its owner's items
and items shared to it, never another member's private memory, and a
`deny`/`require_approval` policy (e.g. medical) still dominates per the engine's
fixed precedence.

### 3. `memory.share` — real sharing

The handler loads the Sphere, finds the item, applies `shareMemoryWithMembers`
(sets `shared_with_members` + records grants, `grantedBy` = the acting subject),
and saves. `family-notes` keeps its `require_approval` preset for share, so a
share suspends for a parent's approval before it takes effect.

### 4. The adapter reads context, never trusts agent input

All three handlers take the Sphere id and acting subject from the governed
context. Capture owns the item to the caller; search scopes to the caller's
authorized set; share attributes the grant to the caller. An agent cannot capture
into, read, or share another Sphere's memory by lying about ids.

## Domain impact

- New catalog capability `memory.capture` (+ audit facts: actor, capability,
  decision, correlationId — never content).
- `family-notes` manifest gains `memory.capture` (provides + binding + adult grant
  preset); its `memory.search` / `memory.share` bindings now resolve to real
  handlers. No change to the capability *names* it already provided.
- The local handlers factory gains a `SphereStore` dependency (memory + policies
  live in the Sphere snapshot); handlers load-filter (search), load-append-save
  (capture), load-mutate-save (share).
- No change to the `MemoryItem` model, `resolveReadableMemory`, the Policy Engine,
  the projection/Sphere-MCP contracts, or tokens.

## Security and privacy impact

- **Policy-scoped retrieval is the whole point, and it is enforced by the existing
  resolver**, not re-implemented: structural visibility as a lowest-priority
  synthetic allow, with any real deny/require_approval dominating. An item with no
  structural visibility is denied by default.
- **Scope from the governed context, not agent input** — the same isolation
  guarantee as RFC-012; an agent cannot reach another member's or Sphere's memory
  by supplying ids.
- **Audit stays minimal** (invariant 16): capture/search/share record the security
  fact (actor, capability, decision, correlation) — never the note content.
- **Private by default; revocable by default**: capture creates private memory;
  sharing is explicit and approval-gated; a share widens scope only after a
  parent approves.

## Alternatives considered

- **A separate `MemoryStore` table** instead of the Sphere snapshot. Deferred:
  memory already persists in the snapshot via `exportSphere`; adding a table is a
  storage refactor with no behavioural gain for this slice.
- **Re-implement item filtering in the handler.** Rejected: `resolveReadableMemory`
  is the accepted ADR-002 rule; the handler must reuse it, not fork it.
- **Make capture default to a wider scope** so search demos are easier. Rejected:
  inverts ADR-002 private-by-default and invariant "silence is never consent".

## Open questions

- Embeddings/semantic search (the query filter here is a substring match; ADR-002
  keeps embeddings derived/regenerable — a later slice).
- Memory edit/redact/forget capabilities and their risk tiers.
- Whether capture should allow a non-private initial visibility via an explicit,
  audited argument.

## Acceptance criteria

- `memory.capture` records a private note owned by the acting subject, through the
  governed pipeline.
- `memory.search` returns only items the subject is authorized to read: an agent
  sees its owner's notes and notes shared to it, never another member's private
  note — verified live.
- `memory.share` (after approval) makes an item visible to the named member, and a
  subsequent search by that member returns it.
- Scope always derives from the governed context, never from `tools/call` input.
