# RFC-029 — Store essentials: shared notes, projects, and documents

## Status

Accepted

## Summary

Implement four capabilities the accepted domain catalog
(`docs/domain/capability-catalog.md`) already blesses but code never shipped, and
offer them as two curated store packages:

- **Shared Notes & Projects** — `sphere.note.create`, `sphere.project.create`
  (the *write* side: shared, Sphere-scoped content, distinct from private memory).
- **Documents** — `document.search`, `document.summarize`
  (the *read* side: search and summarize the Sphere's shared written content).

The two compose: a shared note written by one member's agent is discoverable and
summarizable by another's, all governed by policy per call.

## Motivation

The store has a package for every *action* capability currently in the code
catalog, so the gap is not missing packages — it is capabilities the domain
already specifies that code hasn't implemented. Of the domain-blessed set, shared
notes/projects and documents are the obvious family "essentials": "write this down
for everyone," "what did we note about the trip," "summarize the school letter."
They are all low/medium risk and read-mostly — the right low-hanging fruit.

## Proposal

### Capabilities (added to the code catalog, matching the domain doc)

| name | risk | profiles | approval floor |
|------|------|----------|----------------|
| `sphere.note.create` | medium | adult, teen | no |
| `sphere.project.create` | medium | adult, teen | no |
| `document.search` | low | adult, teen, child | no |
| `document.summarize` | low | adult, teen, child | no |

The table is the **catalog floor** — the profiles for which a capability is ever
*permissible*. `document.*` are read-only, so the floor permits children (a
supervised child's agent may *read* shared documents); `sphere.*.create` are
writes, so their floor is adult/teen. The floor is not a grant: per invariant 8
(minors deny-by-default) the store packages' **default** grant is **adults only**,
and an admin widens to teens/children with a custom grant at enable time. Every
call is still policy-checked.

### Data model

- **A shared note is a `MemoryItem`**, owned by the Sphere (`ownerType: "sphere"`)
  with Sphere visibility. No new entity: shared notes reuse canonical memory, so
  `memory.search` and `document.search` both find them, and export/restore already
  carry them. `sphere.note.create` is the governed writer that creates memory
  *shared* (an explicit, audited widening — never the silent default, which stays
  private per ADR-002).
- **A project is a new minimal entity `SphereProject`** `{ id, sphereId, ownerId,
  ownerType, title, description?, state, createdAt, updatedAt }`, carried in a new
  **optional** `projects[]` export section (backward-compatible, like
  `integrations`/`packages`; no format-version bump, empty when absent).

### Bindings (MVP reference; mechanism only, authorizes nothing)

Local executor handlers, replaceable by an integration later without touching
policy (the integration-model pattern already used by `google-calendar`):

- `local.sphere_note_create` — create a Sphere-visible memory item.
- `local.sphere_project_create` — create a `SphereProject`.
- `local.document_search` — read-only search across the Sphere's **shared**
  (Sphere-visible) content; never a member's private memory.
- `local.document_summarize` — a **deterministic extractive** summary of one
  shared item by id (first sentences, bounded). Honest MVP: no model call, no
  provider dependency in the domain; a real summarizer is a later binding.

`document.search` reading the Sphere's shared notes is the MVP reference source
for "authorized documents." A real Documents integration (Drive, Dropbox, a file
store) replaces the `document.*` binding later — capability and policy unchanged.

### Store packages

- **`shared-workspace`** (skill, ageRating all) — provides `sphere.note.create` +
  `sphere.project.create`; default grant: **adults** may create shared notes and
  projects (`allow`); widen to teens via a custom grant.
- **`family-documents`** (skill, ageRating all) — provides `document.search` +
  `document.summarize`; default grant: **adults** may search and summarize the
  Sphere's shared documents (`allow`, read-only); widen to teens/children via a
  custom grant.

## Domain impact

Four catalog entries; one new entity `SphereProject` and an optional `projects[]`
export section (`exportSphere`/`importSphere`/`ImportedSphere` extended, defaulting
empty — restore of an older snapshot is unaffected); four local handlers; two store
manifests. No change to the policy engine, approval flow, or event model. Shared
notes are ordinary memory items, so no memory-model change.

## Security and privacy impact

- **Private stays private (ADR-002).** `sphere.note.create` widens visibility only
  by being the explicit, audited "make this shared" action; it never changes the
  default that captured memory is private. `document.search` returns **only**
  Sphere-visible content — never private items — so it cannot become a read-around
  of the memory visibility rules.
- **Deny by default.** New capabilities are denied to any profile off their floor
  and to everyone until a Sphere policy (the package grant, or an admin's own)
  allows them. Writing is adult/teen; children read-only.
- **Audit minimally.** Handlers record the security fact (actor, capability,
  resource id, decision, correlationId) — never note/document *content* (§18). A
  summary is a derived read result returned to the caller, not written to the log.
- **Minors.** A child's agent may *read and summarize* shared family documents
  (supervised, low-risk) but cannot create shared content — matching the domain's
  "child: read-only/internal by default."

## Alternatives considered

- **A distinct `SphereDocument` entity with an ingestion path.** Rejected for MVP:
  the domain blesses `document.search`/`summarize` but *not* `document.create`, so a
  document entity would have no governed way to be filled and the package would be
  inert. Binding `document.*` to the shared-notes the workspace package creates
  makes it usable today and upgrades cleanly to an external source.
- **Model-backed `document.summarize`.** Rejected for MVP: it would pull a provider
  dependency into a local handler (breaks domain purity) and make the capability's
  cost/behaviour model-dependent. A deterministic extractive summary is honest and
  pure; a real summarizer is a later binding, capability unchanged.
- **Fold shared notes into `memory.capture` with a `visibility` argument.**
  Rejected — the domain models `sphere.note.create` as its own capability (a shared
  write is a different risk/consent story than a private capture); a distinct
  capability keeps the audit and the grant explicit.

## Acceptance criteria

- The four capabilities are in the catalog with the risks/profiles above; an
  unknown one is still denied.
- Installing + enabling **Shared Notes & Projects** lets an adult agent create a
  shared note (a Sphere-visible memory item) and a project; minors are denied by
  the default grant (invariant 8) until an admin widens it.
- Installing + enabling **Documents** lets an adult agent search and summarize the
  Sphere's shared notes; `document.search` never returns a private memory item.
- `projects[]` round-trips through export → restore; an older snapshot without it
  restores unchanged (empty projects).
- Verified live against the running API: create a shared note, find it via
  `document.search`, summarize it, and confirm a private item is not returned.
