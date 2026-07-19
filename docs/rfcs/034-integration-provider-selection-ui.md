# RFC-034 — Integration provider selection in the config screen

## Status

Accepted

## Summary

Let an admin **choose the provider** that backs an integration package from the
Connectors config screen — e.g. Documents backed by `local` (KinOS's shared notes,
no setup) or `google_drive` (real Drive, OAuth); Calendar by `local` / `google` /
`caldav` / `apple`. The manifest already declares `providerChoices`, and the
`integration.configure` endpoint already accepts a `provider`; this surfaces the
choice in the entity, the read API, and the UI, and shows the right connect
affordance per provider (none / OAuth / api-key). No secret is ever typed for OAuth.

## Motivation

Integration packages are configurable adapters (RFC-016): the same capability can be
backed by different providers. `providerChoices` was declared on the manifest but
surfaced **nowhere** — the UI silently used the manifest's default provider, so an
admin could not pick "use my local shared notes" vs "connect Google Drive" without
calling the API by hand. That is the missing piece of a real per-package config
screen. (Note: this is Sphere/package-level config; the OAuth *client* credentials
that make real Google work are a separate one-time deployment setting —
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — not entered per package.)

## Proposal

1. **Carry `providerChoices` on the Integration entity.** The domain `Integration`
   (and `createIntegration`) gain an optional `providerChoices?: string[]`;
   `packageIntegration` copies it from the manifest. The integration becomes
   self-describing — it knows the providers it may use, independent of the catalog.

2. **A provider → auth-kind classifier** (app layer, beside the OAuth map):
   `providerAuthKind(provider) → "none" | "oauth" | "apikey"` — `local` needs no
   auth; a provider in the OAuth map (`google`, `google_drive`, `apple`) is `oauth`;
   anything else (`caldav`) is `apikey`. One place owns this fact.

3. **The read API exposes the choices with their auth kind.** `GET
   …/integrations` returns, per integration, `providerChoices: [{ provider, auth }]`
   alongside the current `provider`/`auth`/`configured`. Facts only — never a secret.

4. **`integration.configure` sets `auth` to match the chosen provider.** When the
   provider changes, the handler updates the entity's `auth` via `providerAuthKind`
   (a `none` provider clears it), so the connect affordance stays coherent. It still
   refuses a raw credential value (references only) and is admin-gated (unchanged).

5. **The Connectors screen renders a provider selector** when an integration offers
   more than one choice. Picking a provider persists it (`configure`), then the row
   shows the affordance for that provider: `local` → just Enable (no credentials);
   `oauth` → Connect (consent via the broker, RFC-017); `apikey` → a secret-reference
   field. The default selection is the integration's current provider.

## Domain impact

One optional field on `Integration`/`createIntegration`/`packageIntegration`
(backward-compatible; an older integration without it simply offers no selector). No
new capability, policy, event, or approval. The provider→auth classification and the
UI are app-layer.

## Security and privacy impact

- **No new authority; still governed.** Choosing a provider is `integration.configure`
  — already admin-gated and audited (records `provider=… credentialed=…`, never the
  reference). Selecting a provider does not enable it or grant any capability; enable
  and the Policy Engine still gate use.
- **Secrets stay by reference.** OAuth providers show a Connect button (broker
  account reference, never a token); api-key providers take a `secret://…` reference,
  never a raw value (the existing raw-credential guard is unchanged). `local` needs no
  credential and the executor already requires none for it.
- **Least privilege preserved.** The selectable set is exactly the manifest's
  `providerChoices` — an admin cannot point an integration at an arbitrary provider.
- **Deny-by-default unchanged.** A newly-configured provider is still `proposed`
  until a governed enable; an external provider with no reference still refuses at
  execution.

## Alternatives considered

- **Look up `providerChoices` from the store manifest at read time** (by the
  `int_<packageId>` id convention) instead of storing it on the entity. Rejected —
  couples the read surface to an id-naming convention and to the catalog still
  containing the package; storing it makes the integration self-describing and
  survives catalog changes.
- **Return only `providerChoices: string[]` and classify auth in the UI.** Rejected —
  it duplicates provider knowledge (which is OAuth vs api-key vs none) into the
  client. The API returns the auth kind so the UI stays declarative.
- **A separate "provider" step in the store install flow.** Rejected — provider
  choice is ongoing config (an admin may switch local↔Drive later), so it belongs on
  the Connectors config screen, not a one-shot install wizard.

## Acceptance criteria

- `GET …/integrations` returns `providerChoices` (with per-provider auth kind) for an
  integration package that declares them; an integration without choices returns none.
- The Connectors screen shows a provider selector for such an integration; choosing a
  provider calls `configure` and the row then shows the matching affordance
  (Enable / Connect / secret field).
- Configuring `provider=local` needs no credential and enables; `google_drive` shows
  Connect; `caldav` shows the reference field.
- `integration.configure` still refuses a raw credential value and stays admin-gated.
- Verified live against the running API: switch the Documents integration between
  `local` and `google_drive` and observe the summary + affordance change.
