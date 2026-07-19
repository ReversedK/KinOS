# RFC-033 — Incremental OAuth scopes: one account, multiple integrations

## Status

Accepted

## Summary

Let a Sphere connect several integrations that share one social login (e.g. Google
Calendar *and* Google Drive on the same Google account) without the second connect
dropping the first's access. When beginning an OAuth connect, request the **union**
of the real OAuth scopes for every integration in the Sphere that maps to the same
social provider — so a single consent grants everything the Sphere's integrations
for that login need. This resolves RFC-032's open question without relying on any
provider-specific incremental-authorization behaviour.

## Motivation

RFC-032 mapped KinOS provider ids to a social provider + real scopes, and noted:
connecting both `google` (calendar) and `google_drive` (documents) maps to one
Better Auth Google account; each connect requested only its own scopes, so the
second consent could leave the account without the first's scope. A family that
connects Calendar then Documents would find Calendar broken (or need to re-consent).

The clean fix must not depend on Google's `include_granted_scopes` accumulation (an
unverifiable provider detail here): request all the scopes up front, so the granted
account covers every Google integration the Sphere installed — in any connect order.

## Proposal

Scope resolution moves to where the Sphere context lives — the governed
`integration.oauth.begin` handler — and the broker becomes a thin requester:

1. **`oauth-providers.ts`** gains `unionRealScopes(providers)`: the deduped union of
   the real OAuth scope URLs across the given KinOS provider ids (unmapped ignored).

2. **The begin handler** computes the connect scopes as the union across the
   Sphere's integrations whose provider shares the **same social provider** as the
   integration being connected (including that integration). It passes those real
   scopes to `broker.beginConnect`. So:
   - a Sphere with only Documents requests just `drive.readonly` (least scope);
   - a Sphere with Documents *and* Calendar requests `drive.readonly` + calendar on
     either connect — one consent, both usable, in any order.

3. **The broker** (`beginConnect`) maps the KinOS `provider` to its social provider
   (unknown → refuse) and requests exactly the real `scopes` it is given. It no
   longer derives scopes itself (RFC-032 put that in the broker; the union needs
   Sphere context the broker lacks, so it moves out — real scope *strings* still
   live only in `oauth-providers.ts`, never in the router or domain).

`getAccessToken` is unchanged (RFC-032): it still refreshes under the social
provider. The Integration entity's abstract scopes are unchanged; each integration
still sets its own `secretRef` at its own connected callback, now pointing at a
Google account that already holds the union of scopes.

## Domain impact

None. An app-layer change: one helper, a scope computation in the begin handler,
and the broker requesting given scopes instead of deriving them. No capability,
policy, event, or entity change. `FakeAuthBroker` is unaffected (it ignores scopes).

## Security and privacy impact

- **Least scope by what the Sphere uses.** The union is bounded to the Sphere's
  *installed* same-social integrations — never all providers KinOS could support. A
  Sphere that never installs Calendar never requests calendar scope.
- **No new authority; still governed.** `integration.oauth.begin` remains admin-
  gated and audited; the connected account is still stored as a broker reference,
  never a token. Requesting a scope is not using it — every capability call is still
  policy-checked before the adapter runs.
- **Deterministic, not provider-dependent.** Coverage comes from requesting the
  scopes up front, not from trusting a provider to accumulate them, so a broken or
  absent incremental-auth feature cannot silently drop access.
- **Deny-by-default preserved.** An unmapped provider is still refused at begin.

## Alternatives considered

- **Rely on Google `include_granted_scopes=true`.** Rejected — it is a Google-
  specific behaviour not verifiable in this environment, and pushes correctness into
  a provider detail. The union is provider-agnostic and testable.
- **Union across *all* KinOS providers for the social provider (static).** Rejected —
  it over-requests (asks for calendar scope in a Sphere that only installed
  Documents), breaking least-scope. The Sphere-scoped union asks only for what the
  Sphere actually has.
- **Union only across already-connected integrations.** Rejected — it depends on
  connect order (connecting Documents first, then Calendar, would still under-scope
  the first grant). Unioning over *installed* integrations front-loads every scope
  the Sphere will need, so any order works.

## Acceptance criteria

- Beginning connect for `google_drive` in a Sphere that also has a Google calendar
  integration installed produces an authorize URL requesting **both** the
  `drive.readonly` and calendar scopes (verified against a real Better Auth instance).
- Beginning connect for `google_drive` in a Sphere with no other Google integration
  requests only `drive.readonly` (least scope).
- An unmapped provider is refused at begin.
- The governed connect flow still completes end-to-end (begin → connected → enable),
  and each integration sets its own `secretRef`.
- Verified live: the begin flow for a Sphere with both Google integrations completes
  and the union is reflected in the request.
