# RFC-019 — Secret store & non-OAuth credential resolution

## Status

Accepted

## Summary

Introduce a small **secret store** port so an integration's `secretRef` resolves to
actual credentials at execution time for **non-OAuth** providers (Basic auth,
api-key, app-specific passwords). This is the missing counterpart to RFC-018: OAuth
providers already resolve their reference through the Better Auth broker
(`getAccessToken`), but api-key/Basic providers have a `secretRef` that nothing
reads. Resolving it — never storing or returning the value anywhere it can leak —
unblocks the first non-OAuth connectors (CalDAV/Apple app-password, and any
key-authenticated SaaS).

## Motivation

- The Connectors UI (iteration 113) lets an admin save a `secretRef` for an api-key
  integration via `integration.configure`. That reference is persisted on the
  `Integration` but is a dead end: `IntegrationExecutor` passes `secretRef` to the
  provider adapter, and only the Google adapter does anything with it (via the
  broker). A CalDAV/api-key adapter has no way to obtain the real username/password.
- The invariant is **credentials by reference, never value** (`invariants-contract`).
  The reference must therefore resolve *inside the execution boundary*, from a store
  that holds the sealed value — not by threading raw credentials through the domain,
  the read API, audit, or the UI.
- OAuth's secret store is Better Auth. Non-OAuth providers need an equivalent: a
  minimal, pluggable secret store the executor consults, keeping providers uniform
  (`ctx.secret()` regardless of auth kind).

## Proposal

### 1. Port (app layer, not domain core)

A `SecretStore` port in the api package (adapters, per the domain/runtime split):

```
interface SecretStore {
  // Resolve a reference to its sealed material, or undefined if unknown/absent.
  // Deny-by-default: an unknown ref is a missing secret, not an error to leak.
  get(secretRef: string): Promise<SecretMaterial | undefined>;
}
type SecretMaterial =
  | { kind: "basic"; username: string; password: string }
  | { kind: "apiKey"; key: string }
  | { kind: "raw"; value: string };
```

The reference format is opaque to callers (`secret://…`). The store owns parsing.

### 2. Reference vs. value at configure time

`integration.configure` continues to accept only a **reference** — never a raw key
(the UI hint already says so). Populating the referenced value into the secret store
is an out-of-band admin step (dev: a file/env-backed store seeded from
`KINOS_SECRETS`; prod: the deployment's real secret manager). KinOS stores the
reference on the `Integration`; the value lives only in the store.

### 3. Executor wiring

`IntegrationProviderCtx` gains a `secret()` accessor that lazily calls
`SecretStore.get(integration.secretRef)`; adapters call it only when they actually
need to authenticate. Resolution is **deny-by-default**: a `custom`-runtime,
non-`local`, non-OAuth integration whose `secretRef` does not resolve refuses the
call (mirrors the existing "not configured" refusal). OAuth adapters keep using the
broker and never touch the secret store.

### 4. First consumer (separate increment)

A CalDAV provider adapter (Basic auth) resolves `{ username, password }` via
`ctx.secret()` and speaks CalDAV to the configured base URL. Registered as a
drop-in `providerRegistry` entry (`caldav`) exactly as RFC-016 anticipated. This
also covers Apple iCloud and self-hosted (Nextcloud/Fastmail) calendars, which use
CalDAV + an app-specific password. Shipped and tested separately from this port.

## Domain impact

None in the domain core. `Integration.secretRef` is unchanged (still an opaque
reference). New types (`SecretStore`, `SecretMaterial`) live in the app/adapters
layer. No capability, policy, or memory concept changes; the Policy Engine still
authorizes the capability call before the executor resolves any secret.

## Security and privacy impact

- **Value never leaves the store's boundary.** The secret is read at execution time,
  used to build one provider request, and discarded. It is never persisted on the
  `Integration`, never returned by any read endpoint, never placed in audit (audit
  records the security fact — which integration ran — not the credential).
- **Deny-by-default.** Unknown/absent reference → the call is refused, not run with
  empty credentials.
- **No new UI exposure.** The Connectors UI still takes a reference, never a raw key,
  and never displays secret material.
- **Correlation preserved.** The capability call already carries a correlation id
  (policy → execution → integration); secret resolution adds no new principal.

## Alternatives considered

- **Store raw credentials on the `Integration`.** Rejected — violates
  credentials-by-reference; the value would enter snapshots, reads, and backups.
- **Force non-OAuth providers through Better Auth.** Rejected — Better Auth models
  OAuth/social accounts, not arbitrary Basic/api-key material; misusing it is the
  same dishonest-port mistake RFC-018 rejected.
- **A domain-core secret concept.** Rejected — secrets are a runtime/adapter
  concern; the domain core must not gain a credential-handling dependency.

## Open questions

- Per-member vs per-Sphere secret references (shared with RFC-018).
- Rotation/expiry signalling from the store back to the connector status.

## Acceptance criteria

- A `SecretStore` port exists with a dev-usable adapter (file/env-backed) and tests.
- `IntegrationProviderCtx` exposes `secret()`; a non-OAuth integration with an
  unresolvable `secretRef` is refused (deny-by-default), covered by a test.
- No secret value appears on the `Integration` entity, any read endpoint, or audit
  — asserted by a test.
- The port is consumed by at least one real non-OAuth provider (CalDAV) in a
  follow-up increment, validated with an injected transport — and, beyond the unit
  tests, end-to-end against a live third-party CalDAV server (Radicale): `create`
  PUTs a VEVENT and `read`'s REPORT round-trips it back, with Basic auth enforced
  (unauthenticated request → 401).
