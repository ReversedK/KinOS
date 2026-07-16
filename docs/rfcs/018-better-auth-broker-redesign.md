# RFC-018 — Better Auth broker: redesign the AuthBroker port to the broker's model

## Status

Accepted (2026-07-16)

## Summary

RFC-017 shipped an `AuthBroker` port shaped like a raw OAuth2 code exchange
(`authorizeUrl` + `exchange(code)` + `getAccessToken`). Verifying Better Auth
(via context7) showed it does not fit that shape: **Better Auth owns the provider
callback** (`${baseURL}/api/auth/callback/:provider`, non-overridable), manages
`state` and the code exchange internally, and is session-centric. This RFC
redesigns the port to Better Auth's model and adds the real **`BetterAuthBroker`**,
which compiles against `better-auth@1.6.23`, boots, and mounts its handler.

## Motivation

The RFC-017 port assumed KinOS runs the OAuth exchange. Better Auth doesn't expose
a code-exchange step — it processes the callback itself and stores the account. To
use Better Auth (the chosen broker) honestly, the port must delegate the whole
consent+callback to the broker and only (a) get an authorize URL and (b) identify
the connected account afterwards and (c) fetch tokens by reference.

## Proposal

### 1. Port v2 (replaces RFC-017's `authorizeUrl`/`exchange`)

```ts
interface AuthBroker {
  beginConnect(i: { provider; scopes; callbackURL }): Promise<{ url: string }>;
  resolveConnection(i: { headers }): Promise<{ accountRef: string } | undefined>;
  getAccessToken(accountRef: string): Promise<string>;
  readonly nodeHandler?: (req, res) => void; // Better Auth's /api/auth/*
  readonly basePath?: string;
}
```

- `beginConnect` → the provider authorize URL (Better Auth: `signInSocial({provider,
  callbackURL, disableRedirect})`). `callbackURL` is KinOS's `/oauth/connected` page.
- The broker's own handler (mounted at `basePath`) processes the provider redirect,
  stores the account/tokens, and redirects the browser to `callbackURL`.
- `resolveConnection` reads the broker session (cookie) from the request headers and
  returns an **account reference** — never a token.

### 2. Governed flow (updated)

- **`integration.oauth.begin`** (governed, admin, unchanged) mints a single-use
  `nonce`, records a pending connection binding the round-trip to the integration,
  builds `callbackURL = /oauth/connected?nonce=…`, and returns
  `beginConnect(...)`'s authorize URL.
- **`GET /oauth/connected?nonce`** redeems the nonce (CSRF + binding),
  `resolveConnection(headers)` → account reference, sets the integration's
  `secretRef` to `provider::accountRef`, audits consent. (Replaces RFC-017's
  `/oauth/callback` which did the code exchange.)

### 3. The real `BetterAuthBroker`

`betterAuth({ baseURL, basePath, secret, database: memoryAdapter, socialProviders:
{ google, apple } })`; `nodeHandler = toNodeHandler(auth)` mounted at `/api/auth/*`
by the KinOS server; `beginConnect → auth.api.signInSocial`; `resolveConnection →
auth.api.getSession` (via `fromNodeHeaders`); `getAccessToken → auth.api.getAccessToken`
(auto-refresh). Selected in `main.ts` when `BETTER_AUTH_SECRET` + `GOOGLE_CLIENT_ID`
+ `GOOGLE_CLIENT_SECRET` are set, else the `FakeAuthBroker`.

### 4. Server plumbing

`ApiRequest` gains `headers` (to read the broker session). The Node server mounts
`deps.authBroker.nodeHandler` verbatim at its `basePath` before router handling.

## Domain impact

App layer only. No domain-core change. The `Integration.secretRef` now holds a
broker account reference (`provider::userId`) instead of a raw OAuth exchange ref;
the entity is unchanged.

## Security and privacy impact

- **Tokens never enter KinOS** — Better Auth stores them; KinOS holds only a
  reference; `getAccessToken` fetches fresh per call. Verified: no token appears in
  the integration read surface or audit.
- **CSRF + binding**: the single-use `nonce` binds the browser round-trip to the
  integration; Better Auth adds its own `state`. Unknown/expired/replayed → refused.
- **Governed + audited consent**: begin and connect are admin, correlation-chained
  facts; never the token.
- **Boots verified**: with dummy client credentials the API boots and Better Auth's
  handler answers `/api/auth/ok` (200) — the adapter is real, not a stub.

## Alternatives considered

- **Keep RFC-017's raw-OAuth2 port** and a hand-rolled OAuth2 client. Rejected —
  the product owner chose Better Auth; one broker across services is the goal.
- **Force Better Auth into the RFC-017 port** (a no-op `exchange`). Rejected — a
  meaningless port method is dishonest design.

## Open questions

- Durable Better Auth account store (memory adapter → SQLite/Postgres) for
  multi-process / restart durability.
- Per-member vs per-Sphere connected accounts.
- Apple's signed-JWT client secret (a provider-config detail).
- Live Google/Apple consent requires real client credentials + a browser — the one
  path not exercised in CI.

## Acceptance criteria

- The port matches Better Auth's model; the `BetterAuthBroker` compiles against the
  installed `better-auth`, boots, and mounts `/api/auth/*` (verified: `/api/auth/ok`
  → 200).
- The governed flow (begin → `/oauth/connected`) works end to end via the fake
  broker; nonce replay/forgery is refused; no token leaks into the read surface or
  audit.
- Real Google/Apple consent is a deployment step (client credentials); documented.
