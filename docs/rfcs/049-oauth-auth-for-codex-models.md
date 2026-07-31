# RFC-049 — OAuth authentication for codex (OpenAI) agent models

## Status

Accepted

## Summary

Let the OpenAI inference provider authenticate via **OAuth ("Sign in with ChatGPT")**
instead of an API-key reference, when a **codex** model is selected. The runtime
profile records how it authenticates (`authMethod: "apikey" | "oauth"`); credentials
stay by reference either way (never a raw key or token in the profile/audit/export).
This RFC accepts the auth-method model, a codex-model detector, the governed write and
the UI affordance. The live OpenAI OAuth handshake (broker provider, endpoints, token
refresh) is a deferred, operator-provisioned step (see Open questions) — exactly as the
Google OAuth client was for RFC-017.

## Motivation

Codex models (OpenAI's coding models — e.g. `gpt-5-codex`, `codex-mini-latest`) are
commonly used through a **ChatGPT sign-in** rather than a raw API key: an operator with
a ChatGPT/Codex subscription authenticates once and the runtime uses a broker-managed
token. Today KinOS's only cloud-auth path is a static API-key **reference** in the secret
store. Forcing a raw API key where the user expects "Sign in with ChatGPT" is friction and,
worse, pushes people to paste long-lived keys. An OAuth option — reusing the same
by-reference discipline KinOS already applies to Google — is the natural fit.

A per-agent "codex model" runs under the **Sphere's** OpenAI provider (an agent's
`model.set` only swaps the model string on the Sphere's provider, RFC-004). So the auth
method is a property of the Sphere runtime profile, surfaced when a codex model is in play.

## Proposal

1. **`authMethod` on the runtime profile.** `RuntimeProfile` gains an optional
   `authMethod: "apikey" | "oauth"` (default `"apikey"`, backward-compatible). For cloud
   execution a `secretRef` is still required — for `apikey` it references a secret-store
   key; for `oauth` it references a **broker account** (like Google's `google::broker://…`
   refs), from which the OpenAI runtime resolves a fresh token at call time. No raw
   credential ever lives in the profile, audit, or export.

2. **A codex-model detector.** `isCodexModel(model)` in the core recognises codex model
   ids (case-insensitive match on `codex`). It is advisory: it drives where the UI offers
   the OAuth option and can gate validation; it authorises nothing.

3. **Governed write.** The existing `runtime.set_provider` path (admin-only, deny-by-
   default, cloud-enable gated per RFC-046) accepts the optional `authMethod` and threads
   it into the profile. Choosing `oauth` does not bypass the cloud-enable grant or any
   policy — it only records the auth mechanism.

4. **UI.** In the runtime settings, when the provider is OpenAI **and** the model is a
   codex model, an **auth-method** choice appears: *API key (reference)* (the existing
   secret-ref field) or *OAuth · Sign in with ChatGPT*. The OAuth option is wired to the
   OAuth-connect flow when an `openai` broker provider is configured; until then it shows
   the operator-provisioning hint (mirroring the Google `GOOGLE_CLIENT_ID` hint).

## Domain impact

- **Entities:** `RuntimeProfile` gains optional `authMethod` (default `apikey`). No new
  entity. `createRuntimeProfile` still enforces `secretRef` for cloud, whatever the method.
- **Capabilities:** none added. Setting the profile stays `runtime.set_provider`
  (admin-only, RFC-004/046). Enabling cloud stays the RFC-046 approval-floored grant.
- **Memory / models:** unaffected. Changing auth method is "boring" — no memory or policy
  migration (invariant: changing models must be boring).

## Security and privacy impact

- **Credentials by reference (unchanged):** OAuth stores a broker account reference, not a
  token; the token is fetched at use and never retained in the profile/audit/export
  (ADR-007, RFC-017/032). API keys likewise stay as secret-store references.
- **Deny by default:** OAuth does not relax anything. Cloud stays off until the RFC-046
  grant enables it; minors are denied cloud; `runtime.set_provider` stays admin-only.
- **External transfer:** a codex model is cloud inference — the same external-transfer
  consent/audit as any cloud provider applies; OAuth only changes how the provider is
  authenticated, not that inference leaves the machine.
- **Threats:** a broker token is bounded to the provider; revoking the OAuth connection
  blocks future use while past use stays as audit facts (revocable by default).

## Alternatives considered

- **API key only (status quo).** Works, but forces raw keys where users expect a ChatGPT
  sign-in and encourages pasting long-lived secrets. Rejected as the sole path.
- **Treat the OpenAI provider as an Integration** (reuse the connectors' OAuth flow).
  Mismatch: the inference provider is `runtimeConfig`, not an `Integration` entity; bending
  one into the other would blur two governance models. The auth method belongs on the
  profile; the broker machinery is shared at the adapter layer.
- **A separate `codex` provider id.** Unnecessary — codex is an OpenAI model; the provider
  stays `openai`, the model string identifies codex, and `isCodexModel` detects it.

## Broker mechanism (decided + built)

The Better Auth broker is reused (PO decision). OpenAI is registered as a Better Auth
**generic OAuth2** provider (the `genericOAuth` plugin), not a built-in social provider:
`OAUTH_PROVIDERS.openai` marks it `generic: true`; the broker's `beginConnect` branches to
`signInWithOAuth2` for generic providers (built-in Google/Apple still use `signInSocial`),
and `getAccessToken` resolves it by `providerId` uniformly. It is gated on deployment env
(`OPENAI_OAUTH_CLIENT_ID/SECRET` + `OPENAI_OAUTH_AUTHORIZE_URL/TOKEN_URL`); all unset ⇒ the
provider is not registered, exactly like Google. A broker unit test proves the authorize
URL is built offline for a configured OpenAI provider.

## Open questions (remaining external work)

- **OpenAI OAuth endpoints + scopes:** the *real* "Sign in with ChatGPT" client id,
  authorize/token URLs, scopes and PKCE specifics are operator-provisioned config (the map
  ships placeholder OIDC scopes `openid/profile/email`). The broker plumbing is in place;
  only real values + a live consent remain, mirroring the Google-client provisioning.
- **Token materialization for inference (remaining):** resolving the broker `accountRef`
  into a bearer for the *actual* inference call. The agent runs via the Hermes projection,
  which references the provider key by env (`${OPENAI_API_KEY}`); wiring the broker
  `getAccessToken(secretRef)` → the projected profile `.env` for `authMethod=oauth` is the
  last hop, and needs live cloud verification (KinOS cloud inference has never been run
  end-to-end). The CLI `selectRuntime` path also still uses a static `SecretResolver`.
- **Token model / availability:** access-token lifetime and refresh for a ChatGPT
  subscription sign-in; which codex models a given plan exposes, and surfacing an
  unavailable-model denial cleanly.

## Runtime connect (built)

The runtime-scoped connect is implemented (the existing OAuth flow was integration-scoped;
the runtime provider is not an Integration). `PendingOAuth` gained a `kind`
(`"integration" | "runtime"`) + a `model`. `POST /spheres/:id/runtime/oauth/begin
{ subject, model }` is admin-gated (the `runtime.set_provider` floor + policy), requires a
**codex** model and that cloud is enabled + OpenAI allowed (deny-by-default), and returns
the OpenAI authorize URL. On return, `/oauth/connected` (runtime branch) resolves the
broker account and **assembles the full OpenAI OAuth profile in one shot** — provider
`openai`, the codex model, `execution: cloud`, `authMethod: oauth`, and
`secretRef = openai::<accountRef>` (a broker reference, never a token) — so no
credential-less cloud profile is ever persisted. The console's runtime settings surface a
**Connect ChatGPT** button when OpenAI + a codex model + OAuth is chosen.

## Acceptance criteria

- `RuntimeProfile` carries an optional `authMethod` (`apikey` default), preserved through
  create/validate, the governed `runtime.set_provider` write, and export/import; cloud
  still requires a `secretRef` regardless of method.
- `isCodexModel` recognises codex model ids and is covered by tests.
- The runtime settings UI offers the OAuth ("Sign in with ChatGPT") auth choice only when
  the provider is OpenAI and the model is a codex model, and records the chosen method via
  the governed endpoint; API-key selection is unchanged.
- OAuth changes no authorization: cloud-enable grant, admin-only set-provider, and
  minor-denial all still apply. No raw key or token appears in the profile, audit, or export.
- The live OpenAI OAuth handshake is explicitly out of scope here and tracked in Open
  questions.
