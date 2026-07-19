# RFC-031 — A real Documents integration (external source for `document.*`)

## Status

Accepted

## Summary

Upgrade `document.search` / `document.summarize` (RFC-029) from the local shared-
notes reference to a real external source, following the RFC-016 integration model
already used by `google-calendar` / `caldav-calendar`. Add a `documents` integration
package whose provider choice selects where documents come from: `local` (KinOS's
own shared notes, the reference) or `google_drive` (a real Google Drive, over
OAuth). The capability names, policies and audit are identical whichever provider
backs them — swapping the source never touches governance.

## Motivation

RFC-029 shipped `document.*` bound to the Sphere's shared notes as the MVP
reference, explicitly noting "a real Documents integration replaces the
`document.*` binding later — capability and policy unchanged." This is that
increment. Families keep documents in Drive/Dropbox, not only in KinOS notes; the
integration-model exists precisely so a capability can be backed by an external
service without re-coding it. Documents is the natural second integration after
calendar.

## Proposal

1. **Provider adapters** (in the integration executor; mechanism only — they
   authorize nothing, they run downstream of the Policy Engine):
   - **`google_drive`** — resolves a fresh access token from the auth broker (the
     same OAuth path as `google` calendar) and calls the Drive API: `files.list`
     (full-text `q=fullText contains …`) for `document.search`; `files.get` +
     `files.export` for `document.summarize` (extractive summary of the fetched
     text). `fetchImpl` is injectable so the broker→token→Drive wiring is testable
     without hitting Google.
   - **`local`** becomes a *composite* built-in provider dispatching by capability:
     `calendar.*` → KinOS's calendar store (unchanged), `document.*` → the Sphere's
     shared notes. This makes `local` uniformly "KinOS's own reference for whatever
     capability," so a Documents integration set to `local` reuses exactly the
     RFC-029 shared-notes behaviour. The shared read/summarize logic is extracted
     once and used by both the RFC-029 local handlers and this provider (no
     duplication, one source of truth).

2. **`document.search` still returns only shared content.** The `local` provider
   filters to `shared_with_sphere` (never a private item), exactly as RFC-029. The
   `google_drive` provider returns only what the connected Drive account exposes
   through the granted read-only scope — an external boundary, not KinOS memory.

3. **Store package `documents`** (integration, ageRating all): providerChoices
   `["local", "google_drive"]`, scopes `["documents.read"]`, auth `oauth`, provides
   `document.search` + `document.summarize`. Default grant: adults may search and
   summarize (read-only). Installing mints a `proposed` Integration; configuring
   selects the provider and (for `google_drive`) connects OAuth; enabling backs
   `document.*` via the chosen source.

## Domain impact

No domain change: `document.*` already exist (RFC-029). This is one integration
package manifest plus two provider adapters and a small extracted documents-source
helper, all in the app/adapter layer. The `local` registry entry becomes the
composite provider. No new capability, policy shape, event, or approval state.

## Security and privacy impact

- **Governance unchanged by the source.** Provider selection is a mechanism
  (RFC-016): the Policy Engine authorizes `document.*` before the executor runs,
  identically for `local` and `google_drive`. Swapping the source is "boring."
- **Deny-by-default at every step (inherited from the integration executor).** A
  `proposed`/`disabled` integration refuses; an external provider with no
  credential reference refuses; an unknown provider refuses. Read-only scope only.
- **Credentials by reference, never value.** `google_drive` uses the OAuth broker
  account reference (RFC-017); no token is stored on the entity, export, or audit.
- **The local provider never widens memory visibility.** It returns only
  `shared_with_sphere` items — a private note is never a "document," exactly as
  RFC-029. `document.*` cannot become a read-around of the memory rules.
- **Adults only by default (invariant 8).** The package grant is adult-scoped; the
  capability floor still permits widening to minors (read-only) via a custom grant.

## Alternatives considered

- **One `google` provider for both calendar and Drive.** Rejected — it couples two
  distinct Google products (and their scopes) under one adapter and one integration.
  A distinct `google_drive` provider id keeps each integration's scopes and lifecycle
  independent; they still share the one OAuth broker.
- **A `documents-local` skill instead of an integration.** Rejected — the local
  reference already ships as the `family-documents` skill (RFC-029). The point of
  this RFC is the *external* source; `local` is included as the integration's
  fallback choice for parity with `google-calendar`, reusing the same shared-notes
  code.
- **Model-backed summarize on the external path.** Rejected for the same reason as
  RFC-029: keep the summary deterministic/extractive (no provider dependency beyond
  the document fetch). A model summarizer is a later, orthogonal binding.

## Acceptance criteria

- Installing + enabling **Documents** with provider `local` searches and summarizes
  the Sphere's shared notes exactly as `family-documents` does; a private note is
  never returned.
- With provider `google_drive` configured (OAuth account reference), `document.search`
  issues a Drive `files.list` full-text query and `document.summarize` fetches and
  summarizes the named file — verified with an injected fetch (no live Google).
- An enabled integration with no credential reference (external provider) refuses;
  `local` needs none.
- The capability, its policies and its audit are identical across providers.
- Verified live against the running API: the `local` documents path works end-to-end
  through the integration executor.
