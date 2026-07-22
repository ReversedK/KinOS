# RFC-038 — Request offline access so OAuth tokens refresh (fix 401 after ~1h)

## Status

Accepted

## Summary

Google integrations worked immediately after connecting but failed with `401`
(surfaced to the agent as a "not found"/error) an hour later. Better Auth's Google
authorize URL did not request **offline access**, so Google issued only a
short-lived (~1h) access token and **no refresh token** — `getAccessToken` then had
nothing to refresh with. Configure the Google provider with
`accessType: "offline"` and `prompt: "consent"` so Google returns a refresh token
and the broker can mint fresh access tokens indefinitely.

## Motivation

Reproduced live: `document.search` on a connected `google_drive` integration
returned real files right after the OAuth connect, then `Google Drive search failed:
401` hours later. Inspecting the authorize URL Better Auth generates showed
`access_type` and `prompt` both absent. Google only returns a refresh token when the
authorization request sets `access_type=offline`; and it only *re-*issues one for an
already-consented account when `prompt=consent` is also set. Without a refresh token,
`AuthBroker.getAccessToken` cannot renew the expired access token, so every
subsequent provider call (Drive, Calendar) 401s.

## Proposal

In `buildAuth`, pass the Google social provider `accessType: "offline"` and
`prompt: "consent"`. The rest of the OAuth flow is unchanged (RFC-017/018/032/033):
KinOS still stores only a broker **account reference**, never a token; provider
adapters still fetch a fresh token per call — which now actually refreshes.

Existing connections made before this change hold no refresh token and must be
**reconnected** once (the connect flow now requests offline access, and
`prompt=consent` guarantees Google mints a refresh token even though the account was
already consented).

## Domain impact

None. One provider-config change in the app-layer broker. No domain, capability,
policy, event, or entity change. The `FakeAuthBroker` (dev) is unaffected.

## Security and privacy impact

- **No new data stored by KinOS.** Offline access means Google (via Better Auth's
  server-side account store) holds a refresh token; KinOS still holds only an account
  *reference* (RFC-018), never a token. The refresh token lives in the same durable
  Better Auth account row as before — nothing new is exposed to KinOS, the agent, or
  the audit log.
- **Consent is explicit.** `prompt=consent` shows the Google consent screen, so
  offline access is granted knowingly by the user; it is not a silent scope
  expansion. Scopes are unchanged (RFC-032/033 least-scope still applies).
- **Longer-lived access is the intent.** A connected integration is meant to keep
  working; refresh is how OAuth does that. Revocation still works — revoking the
  account (or the integration) stops future access (invariant: revocable by default).
- **Testing-mode caveat (deployment note, not a code issue).** While the Google
  OAuth app is in "Testing", Google expires refresh tokens after 7 days regardless;
  publishing the app (or a Workspace-internal audience) removes that limit.

## Alternatives considered

- **Silently re-consent / re-auth on 401.** Rejected — it can't work without a
  refresh token, and papering over the missing offline grant with repeated redirects
  is worse UX than requesting offline access once.
- **`access_type=offline` without `prompt=consent`.** Rejected as the default —
  Google omits the refresh token on re-consent for an already-connected account, so
  existing users (already consented) would still get no refresh token when they
  reconnect. `prompt=consent` guarantees it.

## Acceptance criteria

- The Google authorize URL Better Auth generates carries `access_type=offline` and
  `prompt=consent`.
- After reconnecting a Google integration, `document.search` / `calendar.read`
  continue to succeed beyond the access-token lifetime (no `401` an hour later).
- KinOS still stores only an account reference (no token), and scopes are unchanged.
- Verified: the authorize URL params (unit test); reconnect + read past 1h (live).
