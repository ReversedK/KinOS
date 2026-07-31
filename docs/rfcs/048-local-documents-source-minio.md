# RFC-048 — A local documents source backed by MinIO (S3)

## Status

Accepted

## Summary

Give the `documents` integration package a real documents source that actually
holds files: a Sphere-owned object store (MinIO, S3-compatible), offered as a new
**`minio`** provider choice **alongside** the existing `local` (shared-notes) and
`google_drive` providers — not replacing them. Reading (`document.search` /
`document.summarize`) works the same whichever provider backs it; the `minio`
provider additionally supports **uploading** documents via a new `document.upload`
capability, since a store you own must be writable to be useful. Policies, grants,
the correlation-id chain and audit are unchanged.

## Motivation

After the store consolidation (see PROGRESS), Documents is a single integration
package (`documents`) with a provider choice. Its `google_drive` provider connects a
real external Drive over OAuth, but its `local` provider is a stand-in: it searches
the Sphere's shared notes, so there is no way to keep actual document *files* locally.

A family that wants its documents to stay on infrastructure it controls — no external
provider, no OAuth — has no option today. We want a first-class **local** source that:

- stores real files the Sphere owns, on infrastructure the operator runs;
- requires no external account or OAuth broker;
- is a drop-in adapter behind the existing `document.*` capabilities, so policy,
  grants, approval and audit are unchanged whether documents live locally or in Drive.

MinIO is chosen over a raw host directory because it exposes a uniform S3 API (the same
adapter shape a future real-S3 provider would use), it is trivial to run as one more
container in the compose stack, and it avoids host filesystem path/permission coupling
in a containerised deployment. The domain core stays provider-agnostic; MinIO lives
entirely in an adapter.

## Proposal

1. **A MinIO service** in the deployment (compose): one `minio` container plus a
   per-Sphere bucket naming scheme (e.g. `sphere-<sphereId>-documents`). Credentials
   (access key / secret key) are held **by reference** in the secret store, never in
   the domain, consistent with the CalDAV app-password pattern (RFC-019).

2. **A documents adapter** (`adapters/`, outside the core) implementing
   `document.search` and `document.summarize` against a bucket: list/search objects by
   key and indexed text, fetch an object to summarize. It is a replaceable adapter that
   *implements* the capabilities and defines no permissions (integration-model).

3. **A new `document.upload` capability.** A write capability that puts a document
   (name + content) into the Sphere's store. It is medium-risk, adults-and-teens in the
   catalog floor, and — like every write — **adults-only in the package preset** (invariant
   8); minors are widened only by an explicit custom grant at enable time. `document.search`
   / `document.summarize` are unchanged (read-only). Providers that cannot accept writes
   (the read-only `local` shared-notes source, and `google_drive` in this iteration)
   refuse `document.upload`; the `minio` provider implements it.

4. **Provider wiring.** The `documents` package manifest gains `document.upload` in
   `providesCapabilities` and its `integration.providerChoices` becomes
   `["local", "minio", "google_drive"]` — `local` (shared notes, no auth) and
   `google_drive` (OAuth) are kept; `minio` is added and authenticates via a secret
   reference (`auth: "apikey"`, the same secret-ref connect flow the wizard already has
   for CalDAV). Selecting `minio` at configure time binds `document.*` to the MinIO adapter
   for that Sphere.

5. **Adapter over a port.** The domain/API core depends only on a small `ObjectStore`
   port (`list` / `get` / `put` over a per-Sphere bucket); the real MinIO client lives in
   a `MinioObjectStore` adapter selected at wiring time when `MINIO_ENDPOINT` is set,
   with an in-memory reference `ObjectStore` for dev/tests. No provider SDK leaks into the
   core (coding-principles).

## Domain impact

- **Entities:** an `Integration` whose `provider = "minio"`, `auth = "apikey"`, holding a
  secret *reference*. No new domain entity — MinIO is an adapter, not a domain concept.
- **Capabilities:** one added — **`document.upload`** (write, medium risk, floor
  adult+teen, no approval floor). `document.search` / `document.summarize` are unchanged
  (read, low risk). Blessed in the domain capability catalog by this RFC.
- **Memory:** unaffected. Documents are files in the object store; canonical memory and
  its embeddings are untouched. A future indexing step (document text → search index) is
  derived and regenerable, never the source of truth.

## Security and privacy impact

- **Deny by default / private by default:** unchanged. A document is only reachable
  through a policy-checked `document.*` call scoped to the granted audience.
- **Secrets by reference:** MinIO access/secret keys live in the secret store; the domain
  and audit never see raw credentials (consistent with ADR-007 / RFC-019).
- **Audit minimally:** record the security facts (actor, capability, decision,
  correlationId), never document contents. The object store must not become a log leak.
- **Isolation:** per-Sphere buckets (and least-privilege keys scoped to a Sphere's bucket)
  keep one Sphere's documents unreadable by another. Revocation disables the binding;
  past access stays as audit facts (revocable by default).
- **Threats:** a compromised adapter is bounded to the documents capability surface; it
  cannot escalate because authorization happens before the runtime, not in the adapter.

## Alternatives considered

- **Raw host directory (bind mount).** Simpler conceptually but couples the Sphere to host
  paths/permissions, is awkward to isolate per Sphere, and does not match the S3 adapter
  shape a real-cloud provider would reuse. Rejected for containerised deployments.
- **Keep `local` = shared notes.** The status quo; provides no real document storage, which
  is exactly the gap this RFC closes.
- **Depend on a cloud S3 immediately.** Contradicts the local-first intent; MinIO gives the
  same API locally, and a real-S3 provider can be added later as another adapter.

## Resolved decisions

- **Upload is in scope** (PO decision): this RFC adds `document.upload`, backed by the
  `minio` provider. `local` and `google_drive` stay read-only and refuse it.
- **Bucket per Sphere:** one bucket per Sphere (`kinos-docs-<sphereId>`, lower-cased to a
  valid S3 bucket name), so a least-privilege key can be scoped to exactly one Sphere and
  isolation is structural, not prefix-convention.
- **Index is derived from the store:** MVP search lists bucket objects and matches the
  query against object key + text content on read; there is no separate index to keep in
  sync. If a durable index is added later it stays derived/regenerable from the bucket —
  never the source of truth.

## Open questions

- Content typing / extraction for non-text objects (PDF, docx): the MVP treats objects as
  UTF-8 text; binary extraction is a later adapter concern.
- Making `google_drive` writable (its own `document.upload`) is deferred — this RFC only
  requires the `minio` provider to implement upload.

## Acceptance criteria

- A `minio` service runs in the compose stack; a Sphere can be configured with a `minio`
  documents provider whose credentials are held by reference.
- The `documents` package offers provider choices `local`, `minio`, `google_drive`;
  installing it, choosing `minio`, and connecting binds `document.*` to the MinIO adapter
  for that Sphere (its own bucket).
- `document.upload` puts a document into the Sphere's bucket; `document.search` then
  returns it and `document.summarize` summarizes it — the full round trip through the
  governed pipeline. `local` / `google_drive` refuse `document.upload`.
- `document.upload` is adults-only by the package preset (denied by default for minors),
  widenable only by an explicit custom grant; reads keep their unchanged read policy.
- The `ObjectStore` port keeps the MinIO client out of the core; an in-memory reference
  store backs dev/tests, `MinioObjectStore` backs a real deployment.
- Raw MinIO credentials never appear in the domain export or the audit log.
