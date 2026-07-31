# RFC-048 — A local documents source backed by MinIO (S3)

## Status

Accepted

## Summary

Give the `documents` integration package a real **local** documents source: a
Sphere-owned object store (MinIO, S3-compatible) that actually holds files, rather
than the current `local` provider which only re-reads the Sphere's shared notes.
The `document.search` / `document.summarize` capabilities, their policies, grants
and audit stay identical; only the adapter behind the `local` provider changes.

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

3. **Provider wiring.** The `documents` package manifest keeps `document.search` /
   `document.summarize` and its adults-only read preset. Its `integration.providerChoices`
   becomes `["minio", "google_drive"]` (replacing the notes-backed `local`), with
   `minio` authenticating via a secret reference (`auth: "apikey"`), `google_drive` via
   OAuth. Selecting `minio` at configure time binds `document.*` to the MinIO adapter for
   that Sphere; the connect step supplies the credentials reference (the same secret-ref
   flow the wizard already has for CalDAV).

4. **No policy or capability change.** `document.search` / `document.summarize` remain
   read-only, adults-only by default, with minors widened only by an explicit custom
   grant at enable time (invariant 8). The correlation-id chain (policy → runtime →
   integration) is unchanged.

## Domain impact

- **Entities:** an `Integration` whose `provider = "minio"`, `auth = "apikey"`, holding a
  secret *reference*. No new domain entity — MinIO is an adapter, not a domain concept.
- **Capabilities:** none added or changed. `document.search` / `document.summarize` keep
  their catalog definitions (read, low risk, adults-by-preset).
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

## Open questions

- Bucket-per-Sphere vs. one bucket with a per-Sphere key prefix — which gives cleaner
  least-privilege key scoping?
- Where does the search index live (in MinIO object metadata, a sidecar index, or the
  existing memory store), and how is it (re)built on upload? It must stay derived/regenerable.
- Upload path: is ingestion in scope for this RFC (a `document.upload` capability) or is
  this RFC read-only (search/summarize) with ingestion deferred to a follow-up?

## Acceptance criteria

- A `minio` service runs in the compose stack; a Sphere can be configured with a `minio`
  documents provider whose credentials are held by reference.
- Installing `documents`, choosing the `minio` provider, and connecting binds
  `document.search` / `document.summarize` to the MinIO adapter for that Sphere.
- `document.search` returns objects from the Sphere's bucket; `document.summarize`
  summarizes a fetched object — both gated by the unchanged adults-only read policy,
  denied by default for minors.
- No change to the `document.*` capability definitions, policies, or the correlation-id
  audit chain; switching a Sphere between `minio` and `google_drive` needs no policy edit.
- Raw MinIO credentials never appear in the domain export or the audit log.
