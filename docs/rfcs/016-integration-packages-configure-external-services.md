# RFC-016 — Integration packages: add & configure external services

## Status

Accepted (2026-07-16)

## Summary

Realize the product direction the integration model already describes but nothing
yet wires: **a capability's functionality comes from a configurable integration to
an external service, added as a package — not from provider code re-implemented in
KinOS**. A "Google Calendar" is a package you install, then *configure* (choose the
service, supply credentials by reference, grant scopes); its adapter backs the
`calendar.*` capabilities. This reuses the existing `Integration` entity, the
`Capability Binding`, and the package model — it invents no new brick.

This RFC's **increment 1** (this slice) delivers the governed **configuration**
flow so the (today inert) Integration entity and the connectors surface become
functional: install an integration package → it creates a configurable Integration
→ configure it (provider + secret reference + scopes) → enable it. **Increment 2**
(a follow-up) routes a capability call to the configured provider's adapter through
a provider registry; it is scoped out here and called out explicitly.

## Motivation

KinOS re-implemented a local calendar and local notes to prove the governed loop.
That was a scaffold, not the product: `integration-model.md` is explicit that "the
product must not implement every provider directly", that a SaaS connector (Google,
CalDAV) is a first-class integration type, and that "Sphere A can bind
`calendar.create_event` to Google; Sphere B to CalDAV" — agents call the identical
capability, unaware of the backend.

The bricks for this already exist (the `Integration` entity with provider / scopes /
secret reference / status; per-Sphere enable/disable; bindings that name an
integration + operation + secret reference). What is missing is the **governed way
to add and configure** an integration — today nothing creates one, so the connectors
surface has nothing to show. This RFC adds exactly that missing step, reusing the
existing entity rather than re-coding functionality.

## Proposal (increment 1)

### 1. A package can declare an integration

`PackageManifest` gains an optional `integration`:
`{ provider: string; providerChoices?: string[]; scopes?: string[] }`. An
integration package declares the provider family it configures (e.g. `"google"`, or
a choice of `["google","caldav","apple"]`), the scopes it will request, and — via
its existing `providesCapabilities` — the capabilities that integration backs. It
carries no local binding: its capabilities run through the configured integration,
not in-process KinOS code.

### 2. Install creates a configurable Integration (proposed)

Installing an integration package creates a Sphere `Integration` via the existing
`createIntegration` — status `proposed` (deny by default), provider from the
manifest, `providesCapabilities` from the manifest, no secret yet. It appears in the
connectors surface as an unconfigured, disabled connector.

### 3. `integration.configure` — the governed configuration step

New catalog capability `integration.configure` (admin, high risk, adult-only). It
sets, on a Sphere integration: the chosen **provider** (from the package's choices),
the **secret reference** for credentials (a secret-store reference — never the value;
credentials never enter a domain entity, audit, or export), and the requested
**scopes** (visible to administrators, integration-model rule). It is a governed
write like `runtime.set_provider`: the Policy Engine decides, and the admin seed
grants it.

### 4. Enable / disable reuse the existing integration lifecycle

Enabling the integration uses the existing `enableIntegration`; the connectors
surface already toggles it. Disabling blocks future capability calls that resolve to
it (increment 2). Removing blocks the future; audit history remains.

### Increment 2 (scoped out — follow-up)

Routing a capability call to the configured provider's adapter: a provider **registry**
keyed by provider id, the executor resolving the Sphere's enabled Integration for a
capability and dispatching to `registry[provider]` with the secret reference. The
built-in local calendar/notes become the reference `"local"` provider (reused, not
re-coded); Google/CalDAV/Apple are drop-in registry entries. An unconfigured or
disabled integration denies the call by default. This is deliberately a separate
slice so increment 1 ships the configuration mechanism cleanly.

## Domain impact (increment 1)

- `PackageManifest` gains optional `integration` metadata (packages without it are
  unchanged).
- New pure fn `packageIntegration(manifest, sphereId, id)` → `createIntegration(...)`.
- New catalog capability `integration.configure`; admin seed grants it.
- Install handler creates the Integration for an integration package.
- No change to the `Integration` entity, the Policy Engine, the projection/Sphere-MCP
  contracts, tokens, memory, or the connectors read/enable/disable endpoints.

## Security and privacy impact

- **Credentials by reference only** (integration-model rule / secret-store.md): the
  configuration step stores a secret *reference*; the value lives in the secret store
  and never enters a domain entity, audit, or export.
- **Deny by default**: a new integration is `proposed`; it backs nothing until
  configured and enabled, both admin-gated and policy-checked.
- **Scopes are declared and visible** to administrators; an external transfer through
  the integration (increment 2) stays auditable under a correlation id.
- **Replaceable without policy change**: the capability name is unchanged whichever
  provider backs it; swapping Google for CalDAV changes `how`, never `whether`.

## Alternatives considered

- **Keep hand-coding each feature (calendar/messaging/payment) in KinOS.** Rejected —
  the explicit correction and the integration model both forbid it: KinOS names
  capabilities, providers implement them.
- **Rip out the local calendar/notes.** Rejected: they are a legitimate `local
  adapter` integration type (the model lists "local adapter | local note store") and
  become the built-in reference provider in increment 2 — reused, not the product's
  only calendar.
- **Let the agent's Hermes profile connect directly to an external MCP.** Rejected:
  that bypasses the Sphere MCP and the Policy Engine; a configured integration is
  invoked only after a policy check (integration sits after the binding in the chain).

## Open questions

- Increment 2's provider registry + executor dispatch, and the first real external
  adapter (CalDAV is credential-simple; Google needs OAuth).
- OAuth/connection flows for providers that need interactive auth (the secret
  reference abstracts the stored token, but obtaining it is provider-specific).
- Multiple integrations backing the same capability in one Sphere (selection/priority).

## Acceptance criteria (increment 1)

- Installing an integration package creates a `proposed` Integration visible in the
  connectors surface, with the manifest's provider and provided capabilities, and no
  secret.
- `integration.configure` sets the provider, a secret *reference*, and scopes on that
  integration — the secret value never appears in the entity, audit, or export.
- Enabling/disabling the integration works through the existing lifecycle.
- No package without `integration` metadata changes behaviour.
