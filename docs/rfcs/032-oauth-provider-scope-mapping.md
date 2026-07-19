# RFC-032 — OAuth provider & scope mapping (wire Google Drive end-to-end)

## Status

Accepted

## Summary

Make the OAuth broker correct for a KinOS **provider id** that is not itself a
social-login provider — specifically `google_drive` (RFC-031), which is a Google
OAuth connection with *Drive* scopes, not a distinct login provider. Introduce a
small mapping: KinOS provider id → the broker's social provider + the real OAuth
scope URLs. This wires the `documents` / `google_drive` integration through the
existing governed connect flow (RFC-017/018) end-to-end, and fixes the same latent
bug on the calendar path (abstract scopes were being sent to the provider verbatim).

## Motivation

RFC-031 added the `google_drive` provider adapter and the `documents` integration,
but the connect flow could not actually authorize it against a real Google:

- **Provider id ≠ social provider.** `BetterAuthBroker.beginConnect` casts the
  provider to `"google" | "apple"` and hands it to Better Auth's `signInSocial`.
  Better Auth has no `google_drive` social provider — the call fails. Drive is a
  Google login with Drive scopes; the *adapter* is `google_drive`, the *login* is
  `google`.
- **Abstract scopes reach the provider.** Integrations carry KinOS-abstract scopes
  (`documents.read`, `calendar.read`) for governance display. `beginConnect` passed
  them straight to the provider, which expects real OAuth scope URLs
  (`https://www.googleapis.com/auth/drive.readonly`). This is also latently broken
  for `google` calendar — it only ever worked against the `FakeAuthBroker`, which
  ignores scopes.
- **Token refresh used the wrong provider.** `getAccessToken` parsed
  `google_drive::userId` and asked Better Auth to refresh provider `google_drive`;
  the account is stored under `google`. It must refresh under the social provider.

## Proposal

Add a provider map (app layer, next to the broker): each KinOS OAuth provider id →
`{ socialProvider, scopes }` where `socialProvider` is the broker's login provider
and `scopes` are the real OAuth scope URLs for that provider's purpose.

```
google        → { socialProvider: "google", scopes: [".../auth/calendar"] }
google_drive  → { socialProvider: "google", scopes: [".../auth/drive.readonly"] }
apple         → { socialProvider: "apple",  scopes: [] }
```

`BetterAuthBroker` uses it in two places:

- **`beginConnect`** resolves the KinOS provider to its `socialProvider` and issues
  the real OAuth `scopes` for it (ignoring the integration's abstract scopes, which
  remain KinOS-internal governance metadata). An unknown provider is refused.
- **`getAccessToken`** maps the account-ref's provider prefix to the
  `socialProvider` before refreshing, so a `google_drive::userId` reference is
  refreshed under the `google` account that actually holds the token.

The abstract scope on the Integration entity is unchanged (governance still records
`documents.read`). The mapping lives entirely in the broker/app layer — the domain
core and the governed begin/connected handlers (RFC-017/018) are untouched; they
already pass `integration.provider` + `integration.scopes` through, and now the
broker translates. The `FakeAuthBroker` is unchanged (it ignores provider/scopes and
still exercises the governed flow deterministically).

## Domain impact

None. No capability, policy, event, or entity change. This is an app-layer broker
correctness fix plus one mapping module. `google_drive` becomes a usable OAuth
provider; `google` calendar's real-provider scopes become correct.

## Security and privacy impact

- **No new authority.** The mapping only translates *how* an already-governed
  connect request reaches the provider. `integration.oauth.begin` is still admin-
  gated and audited; the connected account is still stored as a broker reference,
  never a token (RFC-018).
- **Least-scope by purpose.** Each provider id requests exactly the real OAuth
  scopes its capabilities need — `google_drive` requests `drive.readonly` (read-only,
  matching `document.*`), not broad Drive write. Deny-by-default: an unmapped
  provider is refused at `beginConnect` rather than sent with guessed scopes.
- **Correct token isolation.** Refreshing under the right social provider prevents a
  silent "no token" failure that could otherwise mask a broken connection.

## Alternatives considered

- **Make `google_drive` a Better Auth social provider.** Rejected — it is not a
  login; it is the Google login with different scopes. A social provider per scope
  set would multiply OAuth apps for one identity.
- **Translate each abstract scope to a real one generically.** Rejected as heavier
  than needed: the real scopes are a property of the KinOS provider's *purpose*, so
  a per-provider scope list is simpler and clearer than a per-scope table, and keeps
  the abstract scopes purely for governance display.
- **Store the real scopes on the integration manifest.** Rejected — real OAuth scope
  URLs are a provider/broker detail (integration-model: providers live in adapters,
  not the domain). Keeping them in the broker map preserves that boundary.

## Open questions

- **One Google account, multiple integrations.** Connecting both `google` (calendar)
  and `google_drive` for the same user maps to one Better Auth Google account; the
  second connect updates its granted scopes. Incremental-scope union (so calendar +
  drive coexist on one account) is a follow-up; for now each connect requests its own
  scopes and a family that wants both may need to re-consent. Noted, not solved here.

## Acceptance criteria

- `BetterAuthBroker.beginConnect` for KinOS provider `google_drive` calls the broker
  with social provider `google` and the real `drive.readonly` scope; an unknown
  provider is refused.
- `getAccessToken("google_drive::u1")` refreshes under social provider `google`.
- The governed connect flow (begin → connected → configured secretRef → enable)
  completes for the `documents` integration, and a subsequent `document.search`
  reaches the `google_drive` adapter, which resolves a token via the broker and
  issues the Drive request.
- The calendar path is unchanged in behaviour but now sends real Google scopes.
- Verified end-to-end against the running instance's broker: begin returns an
  authorize URL + nonce; connected sets `secretRef = google_drive::<accountRef>`;
  `document.search` dispatches to the adapter and resolves a token.
