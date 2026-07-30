# RFC-046 — The governed grant to enable cloud inference (completing RFC-004)

## Status

Accepted

## Summary

RFC-004 defines a Sphere as local-first: `allowedProviders: ["ollama"]` and
`cloudInferenceEnabled: false`, with cloud "off until explicitly enabled via a
high-risk, admin-only, approval-gated capability, and can be disabled entirely"
(RFC-004 acceptance criteria). That capability was **never implemented**: nothing
in the codebase ever flips `cloudInferenceEnabled` to `true` or adds a provider to
`allowedProviders`. As a result, selecting an OpenAI (cloud) profile is
structurally impossible — the settings write reaches `assertProfileAllowed` and is
refused with `Provider 'openai' is not allowed in this Sphere` (403), after the
earlier `Cloud execution requires a secret reference` (400) if no secretRef is
given. This RFC adds the missing grant so cloud can be turned on (and off) through
the governed pipeline.

## Motivation

Observed: "impossible to specify an OpenAI cloud model → 400 error." The 400 is the
missing-secretRef guard; even with a secretRef the request hits a 403 because no
Sphere ever permits `openai` or enables cloud. `setDefaultRuntimeProfile`
deliberately "never escalates provider or execution class" (RFC-004, coding
principle 9), so switching the default profile can never itself enable cloud — a
separate, higher-privilege change is required, exactly as RFC-004 specified. It
simply was not built.

## Proposal

Add two governed capabilities and the pure-core state transition behind them:

- **`runtime.enable_cloud`** — high-risk, adult-only, **approval-floored**. Sets
  `cloudInferenceEnabled: true` and unions the requested cloud providers (e.g.
  `openai`) into `allowedProviders`. Enabling external transfer is consequential,
  so a second administrator must release it (catalog approval floor + the core's
  no-self-approval rule; a single-admin Sphere may self-approve per RFC-026).
- **`runtime.disable_cloud`** — high-risk, adult-only, **no approval floor**. Sets
  `cloudInferenceEnabled: false`. A safety kill-switch must never require a second
  person to turn *off*. If the current default profile runs in the cloud, it is
  reverted to the local-first default (Ollama) so the Sphere never projects a
  now-forbidden cloud profile.

Core (`runtime/profile.ts`) gains one immutable helper:

```ts
setCloudInference(config, { enabled, allowProviders? }): SphereRuntimeConfig
```

Both capabilities are bound to local executor tools (like the other
runtime-governance capabilities, RFC-007) and run through the same
begin → (approve) → execute pipeline via `/spheres/:id/capabilities/:name/execute`.
Administrators are granted them through the existing admin-settings seed policy
(`IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES`). Once cloud is enabled and `openai` is
allowed, the existing `runtime.set_provider` flow (RFC-004) works unchanged: pick
`openai`, supply the credential **secret reference** (never the key), save.

## Domain impact

- `runtime/profile.ts`: add `setCloudInference` (pure, immutable). No change to
  `createRuntimeProfile`/`assertProfileAllowed`/`setDefaultRuntimeProfile`.
- `capability/catalog.ts`: two new entries (`runtime.enable_cloud` approval-floored,
  `runtime.disable_cloud` not).
- `runtime/governance.ts`: two capability→tool bindings.
- `provisioning.ts`: add both capabilities to the admin-settings grant.
- No change to memory, policy evaluation semantics, events, or the model port.
  Providers stay adapters — the core still names no SDK (coding principle 1).

## Security and privacy impact

- **Cloud stays opt-in and audited (invariants 13/14).** Enabling is high-risk,
  adult-only, and approval-gated; every enable/disable is an audited security fact
  (actor, capability, decision, correlationId) — no content.
- **Credentials by reference only.** This grant enables the *possibility* of cloud;
  the API key still travels as a secret-store reference through
  `runtime.set_provider`, never inline, never in audit or exports.
- **Disable is unilateral.** Turning cloud off never requires approval, so an
  administrator can always stop external transfer immediately, and a cloud default
  is reverted to local on disable.
- **Prompt is not a boundary (coding principles 2/4).** Enabling cloud does not
  widen memory or capability scope; only policy-scoped memory ever reaches any
  provider, local or cloud.
- **Minors unaffected.** `runtime.set_provider` and these grants are adult-only; a
  minor can neither enable cloud nor select a cloud profile.

## Alternatives considered

- **One `runtime.enable_cloud` capability carrying an `enabled` flag.** Rejected: a
  single approval-floored capability would gate *disabling* too, or — if `enabled`
  came from client input — let a caller disable-then-enable to dodge the floor. Two
  capabilities keep the enable floor unbypassable and the disable path frictionless.
- **Fold cloud-enable into `runtime.set_provider`.** Rejected: RFC-004 explicitly
  separates the escalation (enable cloud) from the boring swap (choose profile);
  merging them would let a profile change silently enable external transfer.
- **Auto-enable cloud when a cloud profile is chosen.** Rejected: violates
  deny-by-default and invariant 13 (cloud is off until *explicitly* enabled).

## Acceptance criteria

- With cloud disabled, `runtime.set_provider` to an `openai`/`cloud` profile is
  refused (403) — unchanged.
- `runtime.enable_cloud` (adult admin) returns `pending_approval`; once granted, the
  Sphere reports `cloudInferenceEnabled: true` and `openai` in `allowedProviders`.
- After enabling, `runtime.set_provider` to `openai`/`cloud` **with a secret
  reference** succeeds; without a secret reference it still fails (400).
- `runtime.disable_cloud` (adult admin) executes immediately (no approval), sets
  `cloudInferenceEnabled: false`, and reverts a cloud default profile to local.
- A minor is denied both capabilities by the catalog profile floor.
- Enabling/disabling changes no memory and no policy; changing provider stays a
  boring swap.
