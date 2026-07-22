# RFC-036 — Redirect back to the console after OAuth connect

## Status

Accepted

## Summary

After an OAuth connect completes, `/oauth/connected` currently returns raw JSON —
the browser lands on a blank page showing `{"connected":true}`. It is a
browser-facing endpoint (the provider redirects the browser there), so it should
**302 redirect back to the console** (the Sphere's connectors view) instead. Add a
minimal `headers` field to the API response so the HTTP layer can emit a `Location`,
and a configurable console URL for the redirect target.

## Motivation

The governed OAuth round-trip is: Connect (console) → provider consent → Better
Auth callback → `/oauth/connected` (sets the account reference). That last hop is a
top-level browser navigation to the API, and today it ends on a JSON page — a dead
end the user has to manually navigate away from. It should return the user to where
they started, with the integration now showing connected.

## Proposal

1. **`ApiResponse` gains an optional `headers`.** `{ readonly headers?:
   Record<string,string> }`. The HTTP server merges them over its defaults, so a
   handler can emit a `Location` (and the JSON content-type is harmless on a 302
   with an empty body). No other endpoint changes behaviour.

2. **A configurable console URL.** `ApiDeps.consoleUrl` (from `KINOS_CONSOLE_URL`,
   default `http://localhost:3100`) — the browser-reachable console origin, distinct
   from `KINOS_PUBLIC_URL` (Hermes→MCP) and `BETTER_AUTH_URL` (the API as the
   browser reaches it).

3. **`/oauth/connected` redirects.** After it redeems the nonce, resolves the broker
   account and sets the integration's `secretRef` (unchanged, RFC-018), it returns
   `302` to `${consoleUrl}/spheres/${sphereId}?connected=${provider}` instead of
   JSON. The console page re-renders server-side and shows the integration connected;
   the query param lets it surface a brief "Connected {provider}" confirmation. If
   the nonce is invalid/expired the endpoint still fails closed (unchanged) — only
   the success path redirects.

## Domain impact

None. One optional field on the app-layer `ApiResponse`, one dep, and a redirect in
one handler. No domain, capability, policy, event, or entity change.

## Security and privacy impact

- **No change to what is stored or exposed.** The redirect carries only the
  Sphere id and the provider name (already non-secret, shown in the console) — never
  the account reference or a token. The `secretRef` is set exactly as before
  (RFC-018), by reference.
- **CSRF/nonce unchanged.** The single-use, admin-minted `nonce` is still redeemed
  before anything is written; an invalid nonce still returns an error, not a
  redirect. The redirect target is a fixed console origin from config, not attacker
  input, so it is not an open redirect.
- **Deny-by-default preserved.** A newly-connected integration is still `proposed`
  until a governed enable.

## Alternatives considered

- **Serve an HTML success page from the API.** Rejected — the console already owns
  the UI; a second mini-UI on the API duplicates styling and drifts. A redirect
  keeps one console.
- **Redirect to a relative path.** Rejected — the API (`:8787`) and console
  (`:3100`) are different origins; the target must be absolute, hence the configured
  console URL.
- **Have the console poll for connection instead of redirecting.** Rejected — the
  browser is already on the API after the provider callback; a direct redirect is
  simpler than bouncing through a polling state.

## Acceptance criteria

- Completing an OAuth connect lands the browser back on
  `${consoleUrl}/spheres/${sphereId}` (302), with the integration shown connected —
  no JSON dead-end.
- An invalid/expired nonce still fails closed (no redirect, no write).
- The redirect Location carries only the Sphere id + provider, never a token or
  account reference.
- Verified live: reconnect an integration and observe the browser return to the
  console.
