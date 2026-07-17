# RFC-022 — Sphere restore (import)

## Status

Accepted

## Summary

Implement `sphere.restore`: an instance-scoped capability that recreates a Sphere
from an export snapshot (RFC-021), completing `results-contract` §17 — "a Sphere can
be exported **and restored**". Export without restore only half-delivers portability:
a backup you cannot restore is not a backup, and an anti-lock-in guarantee you cannot
exercise is a promise, not a property.

**Restore never overwrites.** It refuses if the snapshot's Sphere id already exists
on the instance. That single rule removes the two threats that make import dangerous.

## Motivation

- §17 requires export *and restore*; RFC-021 delivered only export.
- Disaster recovery and instance migration are the concrete use: a lost instance is
  rebuilt by restoring snapshots onto a fresh one.
- Portability is what makes KinOS's local-first, anti-lock-in claim testable. Users
  who cannot move their Sphere are captive regardless of what the docs say.

## Threat model

Import is the more dangerous direction: export *reads*, restore *writes*. The
threats, and how each is addressed:

- **Policy injection** — a crafted snapshot carries policies granting everything to
  everyone. If restore could merge into or overwrite an existing Sphere, it would
  rewrite that Sphere's rules and bypass the Policy Engine wholesale.
  → **Addressed by never overwriting.** A restored Sphere is a *new* Sphere on this
  instance; it can only carry its own permissive rules into its own existence, which
  is no more than `sphere.create` already allows an operator to do.
- **Destruction** — restoring over a live Sphere would silently destroy its current
  memory, policies and agents, irreversibly.
  → **Addressed by never overwriting**: an id collision is refused, not merged.
- **Privilege escalation via the restorer** — the restorer becoming administrator of
  whatever they import.
  → **Addressed by preserving the snapshot's own governance.** Administrators,
  members and policies come from the file. The restorer gets no rights they do not
  hold *inside* that Sphere. Restoring someone else's Sphere does not hand you
  control of it.
- **Disclosure of the snapshot's contents** — *not* a restore threat. An export file
  is readable JSON: whoever can restore it can already read it. Restore grants no
  access to its content that the file-holder lacks. The disclosure decision was made
  at export time, where it is guarded (adult-only, approval-floored, two humans —
  RFC-021).
- **Malformed / hostile payload** — `importSphere` already fails closed on a
  non-object payload, unknown format, unsupported version, or missing sections.
  Restore adds no parsing of its own.
- **Provenance** — a snapshot is not signed, so restore cannot prove a file is one
  KinOS produced. This is an accepted limit: the operator chooses the file, exactly
  as they choose to run the binary. Signed exports are an open question below.

## Proposal

### 1. Capability

`sphere.restore` in the catalog: `risk: "critical"`, `allowedProfiles: ["adult"]`,
`approvalFloor: **false**`.

The absent approval floor is deliberate, and is the one place restore differs from
export. An approval requires approvers — and at restore time the Sphere does not
exist on this instance, so its members do not either. An approval-floored restore
could never be resolved by anyone: the feature would be dead on arrival, not safe.
Restore is therefore **bootstrap-trusted like `sphere.create`**: on an empty
instance, the adult local operator is the root of trust (RFC-008). It grants no more
than `sphere.create` already does, and unlike `sphere.create` it cannot even make the
operator an administrator.

### 2. Authorization

Instance-scoped, evaluated against `bootstrapPolicies()` — extended to authorize
`sphere.restore` for an adult subject, and nothing else. Deny-by-default is intact:
bootstrap trust can bring a Sphere into existence and now recreate one, nothing more.

### 3. API

**`POST /spheres/restore`** `{ subject, snapshot }`, mirroring the `POST /spheres`
bootstrap route. Returns the restored Sphere id. Refuses:

- a snapshot failing `importSphere` validation → `422`;
- a Sphere id that already exists → `409` (never overwrite).

### 4. Audit

A new event type **`sphere.restored`**, recorded with the Sphere id and correlation
id. An auditor must be able to distinguish a Sphere *created empty* from one whose
members, policies and memory *arrived from a file* — that provenance is a security
fact. The snapshot itself is never audited (audit minimality).

### 5. Console

An Import control on the Spheres list: choose an export file, restore it, land on
the restored Sphere. It triggers the governed capability and renders the outcome.

## Domain impact

One new capability, one new `KinEventType` (`sphere.restored`, documented in
`event-model.md`). `importSphere`/`SphereExport` are unchanged — this RFC only calls
them. No memory, policy or entity semantics change.

## Security and privacy impact

- **Never overwrites** — the load-bearing rule; an id collision is a refusal.
- **Deny by default** — non-adults are denied by the catalog profile floor;
  bootstrap authorizes only `sphere.create` and `sphere.restore`.
- **Governance travels with the data** — the restored Sphere is governed by its own
  policies and administrators, not by whoever imported it.
- **Fails closed on bad input** — validation is `importSphere`'s, which refuses
  rather than guesses.
- **Audited with provenance** — `sphere.restored` marks imported origin; the payload
  never enters audit.
- **Embeddings** are absent from the format by design and are regenerated from
  canonical memory after restore (ADR-002: derived, regenerable).

## Alternatives considered

- **Restore with overwrite/merge into an existing Sphere.** Rejected — it is exactly
  the policy-injection and destruction vector, and buys nothing disaster recovery
  needs (a lost Sphere is absent, so there is nothing to overwrite).
- **Approval-floored restore.** Rejected — unresolvable by construction (no members
  exist yet to approve). A gate nobody can open is a broken feature, not a safe one.
- **Restore under a fresh id.** Rejected — it breaks every internal reference
  (agents, policies, memory are Sphere-scoped by id) and would silently produce a
  Sphere that is not the one exported.

## Open questions

- **Signed exports** so restore can verify provenance rather than trusting the
  operator's choice of file.
- A guarded **replace** for "restore over the top" (would need the destruction and
  policy-injection threats answered — deliberately out of scope here).
- Restoring a snapshot from a *future* export version (today: refused).

## Acceptance criteria

- `sphere.restore` exists: critical, adult-only, no approval floor; authorized only
  by the bootstrap set.
- `POST /spheres/restore` recreates a Sphere from an RFC-021 snapshot; the restored
  Sphere is byte-faithful (members, agents, policies, memory, bindings, settings).
- A child is denied; a malformed snapshot is refused; an existing id is refused with
  `409` and the live Sphere is left untouched.
- `sphere.restored` is audited; the snapshot never appears in audit.
- An export → restore round-trip on a fresh instance reproduces the Sphere.
