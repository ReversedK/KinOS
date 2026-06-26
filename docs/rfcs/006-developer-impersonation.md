# RFC-006 — Developer Impersonation (dev-only Acting-As)

## Status

Accepted.

## Summary

A **development-only** affordance to act as any member of a Sphere, so a developer
can exercise the governance pipeline from each member's point of view (adult,
teenager, child, guest) without standing up real authentication. It is strictly
gated behind a development flag, **deny-by-default**, inert in production builds,
grants **no** elevated rights, and records every impersonated action as
impersonated. It deliberately does **not** introduce a general acting-as or
delegation mechanism — that is a separate, larger concern left out of scope.

## Motivation

Testing KinOS means checking that policy, memory scoping and approvals behave
correctly *as seen by different members* — e.g. that a child is denied a parent's
private memory, or that a minor can never approve. Real authentication does not
exist yet (RFC-003 defers it). Seeding and logging in as many real credentials is
heavy for development. The risk is that a quick "log in as anyone" shortcut becomes
a production backdoor or quietly weakens identity invariants (identities never
merge — invariant 19; identity resolution is authoritative — ADR-001). This RFC
scopes the affordance so it is useful in dev and impossible in production.

## Proposal

### What impersonation is

Impersonation is the **identity resolver**, in development mode only, accepting an
explicit "act as `<memberId>`" selection in place of a real credential. The subject
resolves to that member **with their real role and age profile**. The Policy Engine
then governs exactly as it would for that member.

Impersonation **selects whose rights apply; it never adds rights.** An impersonated
child is denied everything a child is denied; an impersonated minor still cannot
approve (ADR-004); sensitive actions still require approval. There is no "god mode".

### Gating — dev-only, deny by default

- Available only when an explicit development flag is set (e.g.
  `KINOS_DEV_IMPERSONATION=1`, and only outside a production build). Absent the
  flag, the feature **does not exist**: the endpoint/route is not mounted and any
  attempt is denied (coding principle 6).
- Production builds compile the affordance out or hard-deny it; it can never be
  toggled on in production by configuration alone.

### Never bypasses the pipeline

- Every action taken while impersonating runs the normal pipeline
  (Identity → Policy → Capability → Runtime/Integration). Impersonation changes
  only *which identity* the resolver returns, nothing downstream.
- The Policy Engine, approvals, memory scoping and audit behave identically to a
  real session for that member.

### Auditing and visibility

- Every impersonated action is audited with `actor = <impersonated member>` **and**
  `impersonatedBy = <developer>`, under a correlation id (coding principles 7, 10).
  The act of switching identity is itself an audit fact (`identity.impersonated`).
- Identities never merge (invariant 19): the audit always shows it was a developer
  impersonation, so representation stays visible and traceable (invariant 17).
- Audit stays security-facts-only — impersonation records who-as-whom, never the
  conversation content (invariant 16).

### UI

The admin/config UI (RFC-003) gains a **member switcher** visible **only** when the
dev flag is on. Selecting a member sets the acting identity for subsequent governed
calls. Sessions (RFC-005) created while impersonating are owned by the impersonated
member and flagged as dev-created.

## Domain impact

- The identity-resolution input gains a **dev-only `actAs` path**; no change to
  policy evaluation, capabilities, or memory semantics.
- A new audit fact type `identity.impersonated` (security fact: developer,
  impersonated member, correlation id).
- A dev-only flag/setting controlling availability; absent in production.

## Security and privacy impact

- **Dev-only, deny-by-default, inert in production** (coding principle 6;
  invariant 13's spirit — nothing security-relevant on by default).
- **No privilege elevation**: impersonation applies an existing member's rights,
  never more; minors stay restricted (invariant 8) and can never approve (ADR-004).
- **Fully audited** (invariants 16, 18): every impersonated action is attributable
  to both the impersonated member and the developer.
- **Identities never merge** (invariant 19): the developer's use of another
  identity is always visible in the audit, never collapsed.
- **Not a delegation feature**: this RFC intentionally excludes any production
  "act as another member" capability, which would carry a much larger identity and
  consent surface.

## Alternatives considered

- **Seed many real credentials and log in normally.** Rejected for dev ergonomics;
  also premature since real authentication is not yet specified.
- **A production "admin god-mode" that sees/does everything.** Rejected: violates
  policy-scoping and deny-by-default (invariants 3, 6, 7) and breaks per-member
  privacy.
- **A general governed acting-as / delegation mechanism (e.g. parent acts for
  child).** Rejected for now: a much larger security surface touching identity and
  consent invariants; out of scope, may be a future RFC. (Chosen scope: dev-only.)

## Open questions

- The path to real administrator authentication and sessions that replaces this in
  production (ties to RFC-003).
- Whether a controlled variant is permissible in staging/QA, and under what audit.
- Whether dev-impersonated sessions (RFC-005) should be visually and durably marked
  so test data is never mistaken for real member data.

## Acceptance criteria

- Impersonation is available only behind an explicit development flag and is absent
  / hard-denied in production builds.
- An impersonated subject resolves with the target member's real role and age
  profile; the Policy Engine governs it identically to a real session — no elevated
  rights, minors still cannot approve.
- Every impersonated action is audited with both the impersonated member and the
  developer under a correlation id; the identity switch emits `identity.impersonated`.
- No production "act as another member" / delegation capability is introduced by
  this RFC.
- With the flag off, no UI member-switcher is shown and no impersonation endpoint
  exists.
