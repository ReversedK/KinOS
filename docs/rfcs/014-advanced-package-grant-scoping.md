# RFC-014 — Advanced (admin-scoped) package grants on enable

## Status

Accepted (2026-07-16)

## Summary

Complete the RFC-011 grant wizard's deferred "advanced path": let an administrator
scope a package's grant to specific **roles, members, or age profiles** at enable
time, instead of only accepting the manifest's one-click adult default. This adds
no authorization mechanism — the grant is still ordinary Sphere policies the Policy
Engine evaluates per call, still bounded by the catalog profile floor — it only
lets the admin say *who* gets *which* of the package's capabilities.

## Motivation

RFC-011 shipped the default grant (enable applies the manifest's adult-scoped
presets) and explicitly deferred scoping to specific roles/members as "its own
slice". That default is often too coarse: a family may want teenagers to *read*
the calendar but not *create* events, or to grant notes search to one member only.
Today the only way is to enable (taking the adult default) and then hand-edit
policies. This makes the intended scoping a first-class, governed input to enable.

## Proposal

### 1. An optional `grant` on the enable request

`POST /spheres/:id/packages/:pid/enable` accepts an optional `grant`: a list of
grant clauses, each `{ roles?, memberIds?, ageProfiles?, capabilities, effect?,
approverRoles? }`.

- When **absent**, enable applies the manifest's `defaultPolicies` exactly as
  today (backward compatible — RFC-011 behaviour unchanged).
- When **present**, enable applies the admin's clauses *instead of* the defaults.
  Each clause materializes into one ordinary active Sphere policy.

### 2. Bounded by the package and by the floor

- **Cannot grant beyond the package**: every capability in a clause must be one the
  package *provides* (`providesCapabilities`); anything else is a 400. An admin
  cannot use enabling a calendar package to grant `payment.execute`.
- **The catalog profile floor still wins**: a clause granting an adult-only
  capability (e.g. `payment.execute`) to a `teen`/`child` age profile is accepted as
  a policy but remains **inert** — the Policy Engine denies it per call by the
  catalog floor (defence in depth; invariant 8). Granting a genuinely minor-safe
  capability (e.g. `calendar.read`) to teens works as intended.
- **`effect`** is `allow` or `require_approval` (default `allow`); an approval clause
  must name at least one approver role.

### 3. Still just policies

The clauses become versioned, editable Sphere policies with stable ids
(`pol_<sphere>_pkg_<pkgId>_grant_<n>`). Enabling remains admin-gated and
policy-checked; disabling still blocks use by disabling the bindings; the grant
policies can be edited or disabled to re-scope or revoke. No new authorization
concept is introduced.

## Domain impact

- New pure core fn `customGrantPolicies(manifest, sphereId, clauses)` + a
  `GrantClause` type, validating each capability against the manifest and
  materializing policies. `packageGrantPolicies` (the default path) is unchanged.
- The `packages/:id/enable` handler reads an optional `grant` and chooses custom vs
  default clauses.
- No change to the Policy Engine, catalog, projection/Sphere-MCP contracts, tokens,
  or memory.

## Security and privacy impact

- **The authorization surface only ever grows through an admin, policy-checked
  enable**, and only by capabilities the package provides — never silently, never
  beyond the package.
- **Minor safety is preserved by construction**: the catalog profile floor denies a
  risky capability for a minor regardless of an over-broad clause, so the advanced
  path cannot be used to slip a minor a dangerous capability.
- The clauses are visible, ordinary policies an admin applies knowingly and can
  edit or disable (revocation blocks the future; invariant 5).

## Alternatives considered

- **A separate `package.grant` capability/endpoint and a distinct confirm step.**
  Deferred (RFC-011 already noted it): folding the scoped grant into enable is the
  minimal, backward-compatible move; a distinct wizard-confirmation UX is a UI
  concern for later.
- **Silently merge custom clauses with the defaults.** Rejected: surprising — an
  admin specifying a grant means "this is the grant", not "add to the adult
  default". Custom replaces default; the admin can restate the default clause if
  they want it too.
- **Enforce minor-safety by rejecting minor clauses for risky capabilities at the
  API.** Rejected as redundant and error-prone: the engine's catalog floor already
  denies them per call; a second gate risks drifting from it.

## Open questions

- A distinct confirm/preview step (show the admin exactly which policies will be
  written before committing) — a UI slice.
- Granting to a specific **agent** (not just member/role) — the policy model has an
  agent selector that is not yet evaluated (see engine.ts); out of scope here.

## Acceptance criteria

- Enabling a package with no `grant` behaves exactly as RFC-011 (manifest defaults).
- Enabling with a `grant` writes exactly the admin's clauses as active policies and
  not the defaults.
- A clause naming a capability the package does not provide is rejected (400).
- A clause granting `calendar.read` to teens lets a teen read; a clause granting an
  adult-only capability to a minor is inert (the floor denies per call) — verified.
