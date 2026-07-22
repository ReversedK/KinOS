# RFC-035 — OAuth state-cookie handling in the broker (fix `state_mismatch`)

## Status

Accepted

## Summary

Make the real Better Auth OAuth connect flow actually complete. Better Auth sets a
signed `state` **cookie** at sign-in and requires it back at the provider callback
as a CSRF token; KinOS's governed broker calls `signInSocial` server-side and, by
the RFC-018 port shape (`beginConnect` returns only a URL), drops that `Set-Cookie`.
The browser therefore has no state cookie and the callback fails with
`state_mismatch`. Disable Better Auth's state-cookie check
(`account.skipStateCookieCheck: true`) — the state **data** (PKCE verifier, callback)
still lives server-side in Better Auth's database, and KinOS already provides the
CSRF binding the cookie was for: the single-use, admin-minted `nonce` at
`/oauth/connected` (RFC-018).

## Motivation

Verified live against the running stack with a real Google OAuth client: consent
succeeds, Google redirects to Better Auth's `/api/auth/callback/google`, and Better
Auth renders `state_mismatch`. Reading the installed `better-auth`
(`dist/oauth2/state.mjs`, `dist/state.mjs`): with a database adapter the state
strategy is `"database"` — the `stateData` (including the PKCE `codeVerifier` and
`callbackURL`) is persisted server-side via `setOAuthState` — **but** `parseGenericState`
still reads a signed `state` cookie and throws `state_security_mismatch` →
`state_mismatch` unless `oauthConfig.skipStateCookieCheck` is set. The cookie is a
pure CSRF token; the flow does not need it for correctness.

The KinOS broker cannot deliver that cookie: `AuthBroker.beginConnect` runs
`signInSocial` inside the governed, policy-checked, audited begin handler and returns
only `{ url }` (RFC-018 — Better Auth owns the callback; KinOS never holds a token).
Forwarding a browser cookie from a server-side POST that is also proxied through the
console origin is neither clean nor origin-correct.

## Proposal

Configure the Better Auth instance with `account: { skipStateCookieCheck: true }`.
This bypasses **only** the state *cookie* comparison; Better Auth still:

- generates and stores the state + PKCE `codeVerifier` server-side (database
  strategy), and looks them up by the `state` param at callback for the token
  exchange — so a forged/unknown `state` still fails;
- validates the authorization code with Google (one-time), creates the account, and
  redirects to the KinOS `callbackURL`.

KinOS supplies the CSRF binding the cookie provided, and more:

- `integration.oauth.begin` is **admin-gated and audited**; the `nonce` is minted
  only for a specific Sphere integration by an authorized admin;
- the `nonce` is **single-use and TTL-bound** (`PendingOAuthStore`), redeemed once at
  `/oauth/connected`, which is where KinOS sets the integration's account reference.

So the browser round-trip is bound to a governed begin by KinOS's own token, not
Better Auth's cookie.

## Domain impact

None. One option on the app-layer Better Auth broker construction. No domain,
capability, policy, event, or entity change. The `FakeAuthBroker` and the governed
begin/connected handlers are unchanged.

## Security and privacy impact

- **CSRF still enforced, by KinOS.** The state cookie's job (bind the callback to a
  legitimately-initiated flow) is done by the single-use, admin-minted, TTL-bound
  `nonce` at `/oauth/connected`. An attacker cannot mint a nonce for a Sphere without
  admin authorization, and cannot replay one (single use).
- **State integrity retained.** The `state` param must still resolve to a server-side
  Better Auth verification record (PKCE `codeVerifier`); a random/forged state does
  not exchange. The authorization code and code are one-time.
- **No token exposure change.** KinOS still stores only a broker **account
  reference**, never a token (RFC-018); provider adapters fetch a fresh token per
  call. `skipStateCookieCheck` changes none of that.
- **Scope unchanged.** Read-only Drive, least-scope union (RFC-032/033) all still
  apply.

## Alternatives considered

- **Forward Better Auth's `Set-Cookie` from begin to the browser.** Rejected — the
  governed begin is a server-side POST (policy check + audit) proxied through the
  console origin; the cookie would land on the wrong origin from the API callback
  (`:8787`), and threading cookies through the broker port breaks the RFC-018
  abstraction (the broker returns a URL, not an HTTP response).
- **Make begin a top-level browser navigation straight to Better Auth.** Rejected —
  it bypasses the governed, audited `integration.oauth.begin` (policy check, nonce
  minting) that KinOS requires; authorization would no longer be enforced before the
  consent.
- **Switch to the `cookie` state strategy.** Rejected — it stores the encrypted state
  *data* in the cookie, so dropping the cookie loses the PKCE verifier entirely
  (worse), not just the CSRF check.

## Acceptance criteria

- With a real Google OAuth client configured, the full connect flow completes:
  consent → `/api/auth/callback/google` → `/oauth/connected` sets the integration's
  account reference (no `state_mismatch`).
- A subsequent `document.search` on a `google_drive`-backed integration returns real
  Drive results (no `401`).
- `document.summarize` on a real Drive file summarizes a Google-native doc as text and
  degrades gracefully for a non-text file (never a `403` throw). Found in live
  verification: the `google_drive` adapter blindly called Drive's `export` (which only
  works for Docs/Sheets/Slides) and 403'd on other files; it now inspects the
  `mimeType` first — export Docs/Slides as text and Sheets as CSV, download `text/*`,
  and return a friendly "not a text document" note for anything else (RFC-031 adapter).
- The `nonce` remains required at `/oauth/connected` (an unknown/expired/replayed
  nonce is still refused).
- Verified live end-to-end against the running stack.
