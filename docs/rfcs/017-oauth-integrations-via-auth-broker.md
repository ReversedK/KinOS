# RFC-017 — OAuth integrations via a pluggable auth broker (Better Auth as reference)

## Status

Accepted (2026-07-16)

## Summary

Many services (Google, Apple, Microsoft, …) authorize via OAuth/OIDC. Rather than
implement each flow, KinOS delegates the OAuth dance and token storage to a single
pluggable **auth broker** in the app layer, and an integration holds only a
**secret reference** to the resulting connected account — never a token. The
reference broker is **Better Auth** (`getAccessToken({ providerId, accountId })`
returns a fresh token, auto-refreshing; social + generic-OAuth providers;
framework-agnostic). This lets the first "Calendar" package connect Google/Apple
through a governed OAuth flow, with credentials by reference and consent audited.

## Motivation

RFC-016 made integrations configurable with credentials by reference, but assumed a
static secret reference (an API key). OAuth services need an interactive **consent
flow** that yields access/refresh tokens KinOS must not hold in a domain entity.
The user's direction: connect Google/Apple to the Calendar package via OAuth, and —
since most services offer OAuth/SSO — handle them all through one broker (Better
Auth). Better Auth is a strong fit: it runs the consent flow for social + arbitrary
OAuth providers and exposes server-side `getAccessToken` with auto-refresh — exactly
the token source an integration adapter needs.

## Proposal

### 1. An integration can declare OAuth auth

`PackageIntegration` gains `auth?: "oauth" | "apikey"`. An OAuth integration is not
configured with a raw secret reference (RFC-016 `integration.configure`); it is
connected through the flow below. The Calendar package's `google`/`apple` providers
are `oauth`; `local` needs none; `caldav` stays `apikey`.

### 2. The auth broker port

An app-layer `AuthBroker` abstracts the OAuth mechanics (Better Auth is one impl):

```ts
interface AuthBroker {
  authorizeUrl(i: { provider: string; scopes: string[]; state: string; redirectUri: string }): Promise<string>;
  exchange(i: { provider: string; code: string; state: string; redirectUri: string }): Promise<{ accountRef: string }>;
  getAccessToken(accountRef: string): Promise<string>; // fresh, auto-refreshed
}
```

The domain never sees it; only the app-layer executor/handlers do.

### 3. The governed connect flow

- **`integration.oauth.begin`** — a governed capability (admin, high risk). It
  mints a single-use `state` (CSRF), records a pending connection
  `{ sphereId, integrationId, provider }`, and returns the broker's **authorize
  URL**. Beginning a connection is an admin, audited action.
- **`GET /oauth/callback?state&code`** — the provider redirects here. KinOS looks up
  the pending `state` (unknown/expired → refuse), calls `broker.exchange`, and sets
  the integration's **`secretRef` to the returned `accountRef`** (a reference to the
  broker-held account/token — never the token). The integration is now configured;
  an admin still enables it. The exchange is audited as an external-transfer/consent
  fact under a correlation id — never the token value.

### 4. The provider adapter resolves the token via the broker

The RFC-016 provider registry entry for `google`/`apple` (increment 2) resolves a
fresh token with `broker.getAccessToken(integration.secretRef)` and calls the real
service API (e.g. Google Calendar). The token is fetched per call and never stored
by KinOS. The HTTP call to the provider is the only provider-specific code; token
acquisition is uniform across all OAuth services via the broker.

### 5. Better Auth as the reference broker

The `BetterAuthBroker` wires Better Auth's social/generic-OAuth providers and maps:
`authorizeUrl` → Better Auth sign-in/link URL; `exchange` → the callback that
persists the account; `getAccessToken(accountRef={providerId,accountId})` →
`auth.api.getAccessToken`. Better Auth's own store holds the tokens; KinOS holds the
reference. Client credentials (GOOGLE_CLIENT_ID/SECRET, Apple keys) are deployment
config. A `FakeAuthBroker` backs tests and local dev without real credentials.

## Domain impact

- `PackageIntegration.auth` (optional). No other domain change: the `Integration`
  entity already holds provider/scopes/secretRef/status; the secretRef now may point
  to a broker account instead of a static secret.
- New catalog capability `integration.oauth.begin`; admin seed grants it.
- App: `AuthBroker` port, `FakeAuthBroker`, a `PendingOAuthStore` (transient, like the
  TUI ticket), the begin + callback handlers, and the OAuth provider adapters using
  the broker. The domain core imports none of it.

## Security and privacy impact

- **Tokens never enter a KinOS domain entity, audit, or export** — only a reference
  to the broker-held account. `getAccessToken` fetches a fresh token per call.
- **Consent is governed and audited**: beginning a connection and completing it are
  admin, correlation-chained, external-transfer/consent facts — never the token.
- **CSRF-safe**: the callback requires the single-use `state` minted at begin;
  unknown/expired states are refused.
- **Revocable**: disabling/removing the integration blocks future calls; unlinking the
  account at the broker revokes the token. Revocation blocks the future, not the past.
- **Deny by default**: an OAuth integration with no connected account (no secretRef)
  is unconfigured and refuses at the executor (RFC-016 inc.2).

## Alternatives considered

- **Implement each provider's OAuth by hand.** Rejected — the whole point is one
  broker across services; Better Auth already does social + generic OAuth with token
  refresh.
- **Store tokens in the Integration entity.** Rejected — violates credentials-by-
  reference and would put secrets in exports/audit.
- **Use Better Auth for end-user login too.** Out of scope — here it is a *service
  connection* broker (connected accounts / tokens), not KinOS's user identity.

## Open questions

- Apple's OAuth specifics (client secret is a signed JWT) — a generic-OAuth config.
- Per-member vs per-Sphere connected accounts (whose Google account backs the Sphere
  calendar?). This RFC treats it as a Sphere-level integration connected by an admin.
- Token/account revocation propagation from the broker back to KinOS.

## Acceptance criteria

- An OAuth integration is connected via `integration.oauth.begin` → authorize URL →
  `/oauth/callback` → the integration's secretRef is set to a broker account
  reference; the token value never appears in the entity, audit, or export.
- The callback refuses an unknown/expired `state` (CSRF).
- A provider adapter obtains a token via the broker and would call the real service;
  with the fake broker the flow is verified end to end without real credentials.
- Better Auth is documented as the reference broker; client credentials are
  deployment config.
