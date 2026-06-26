# RFC-004 — Inference Provider and Model Configuration

## Status

Accepted.

## Summary

KinOS makes the **inference provider and model** a governed, configurable choice
per Sphere (with an optional per-agent override), reached through the existing
`AgentRuntime` port. The MVP supports two providers: **Ollama** (local, default)
and **OpenAI** (cloud). Selecting a cloud provider is an **external transfer**: it
requires explicit consent, is logged, is denied for minors by default, and can be
disabled entirely for a Sphere. Swapping provider or model is "boring" — no memory
migration, no policy change (coding principle 9).

## Motivation

ADR-006 fixed Ollama as the MVP local runtime and named OpenAI only as a possible
later adapter. The product now needs the provider and model to be a **user-facing
setting**. results-contract §16 requires the system to be model-independent: local
models by default, remote models behind explicit consent, model usage logged, and
cloud models disableable entirely. invariants 12 and 13 require providers to stay
adapters and cloud to be optional. None of this is yet captured as an accepted
decision about *configuration*, and there is no accepted home for a **cloud**
adapter (which crosses the local-first boundary).

## Proposal

### Runtime profile as configuration

A Sphere has a **RuntimeProfile** setting selecting how inference runs:

```ts
type RuntimeProfile = {
  providerId: 'ollama' | 'openai';   // MVP providers
  model: string;                      // e.g. 'llama3.2', 'gpt-4o-mini'
  baseUrl?: string;                   // for self-hosted/OpenAI-compatible endpoints
  secretRef?: string;                 // secret-store reference for cloud API keys; never the key
};
```

- The Sphere-level profile is the default. An agent's `modelPreference`
  (`packages/core/src/agent/agent.ts`) may **override within the set the Sphere
  allows** — it can never select a provider the Sphere has disabled.
- The profile selects *which* adapter the runtime uses; it carries no credentials,
  only a secret reference (secret-store.md). Exports store the reference, never the
  key.

### Providers are adapters behind the port

- The `AgentRuntime` port (ADR-001, `packages/core/src/runtime/runtime.ts`) stays
  provider-free. Ollama already implements it (`adapters/runtime-ollama`). OpenAI
  is a **new adapter** (`adapters/runtime-openai`) implementing the same port.
- The domain core never imports an OpenAI/Ollama SDK (coding principle 1). The
  core references the capability/runtime port; provider selection is data, resolved
  to an adapter outside the core.

### Cloud is governed, not default

- **Local-first default**: a new Sphere uses Ollama. Cloud is off until explicitly
  enabled (invariant 13; results-contract §15/§16).
- Enabling a cloud provider, or setting a cloud model, is a **high-risk,
  admin-only, approval-gated** capability — `runtime.set_provider` /
  `model.set` (cloud variants raise to require_approval; local stays low/medium).
- **Cloud can be disabled entirely** for a Sphere; while disabled, any attempt to
  select or use a cloud provider is denied (coding principle 6).
- **Minors**: cloud inference is denied by default for minor profiles (invariant 8);
  a minor's agent falls back to local or is unavailable, never silently cloud.

### Cloud inference is an external transfer

Every cloud inference call leaves the local environment and is therefore an
external transfer (invariant 14, privacy-model.md, integration-model.md):

- it is audited with the data class, destination provider, the consent/policy that
  authorized it, and the correlation id (coding principles 7, 10) — never the
  prompt/response content;
- credentials come from the secret store by reference, scoped to the provider,
  never embedded in the RuntimeProfile, audit events, or exports.

### Boring swap

Changing provider or model changes only the runtime selection. Canonical memory,
policies, bindings, identities and sessions are untouched (coding principle 9;
invariants 2, 26). The same capability requests resolve identically; only the
executing model differs.

### Model discovery (display only)

The UI may list available models per provider through the adapter (Ollama
`/api/tags`; OpenAI model list). This is presentation only — listing a model
grants nothing; selecting and using it is governed as above.

## Domain impact

- New configuration concept **RuntimeProfile** on the Sphere (and an agent-level
  override constrained by it); added to `domain-model.md`.
- New capabilities `runtime.set_provider`, `model.set`, and a Sphere flag
  `cloud_inference_enabled` (default off); catalog entries with cloud variants
  raised to high-risk/approval, minors denied by default.
- `agent.modelPreference` is reframed as a governed selection within the
  Sphere-allowed set (no longer a free advisory tag).
- No change to memory, policy evaluation, or capability semantics.

## Security and privacy impact

- **Cloud optional** (invariant 13): local default; cloud requires explicit,
  audited consent and is fully disableable.
- **External transfer** (invariant 14): every cloud call audited; secrets by
  reference (secret-store.md).
- **Minor protection** (invariant 8): cloud denied for minors by default.
- **Model owns nothing** (invariants 2, 26; coding principle 9): swap is boring.
- **Prompt is not a boundary** (coding principles 2, 4): only policy-scoped memory
  reaches any provider, local or cloud; using a cloud model does not widen access.

## Alternatives considered

- **Hardcode the provider per deployment.** Rejected: the product needs per-Sphere
  configuration, and a cloud option without consent rules violates §16/invariant 14.
- **Let the core know about providers.** Rejected: violates coding principle 1 and
  invariant 12; providers must stay adapters.
- **Allow any model/provider freely once configured.** Rejected: cloud requires
  per-Sphere consent, minor denial, and the ability to disable entirely.
- **Route cloud through the integration/binding layer instead of the runtime
  port.** Considered; the runtime port already abstracts inference and keeps the
  "boring swap" property — kept the port, with cloud calls still audited as
  external transfers like any integration.

## Open questions

- Per-capability provider routing (e.g. summarization local, drafting cloud) and
  whether that belongs in policy or RuntimeProfile.
- Cost limits and quotas for cloud usage (`contextConditions.maxCostCents` was
  deferred in ADR-003).
- Whether prompts must be redacted/minimized before a cloud call beyond existing
  policy scoping.
- Additional providers (Anthropic, OpenAI-compatible local servers) — same port,
  later.

## Acceptance criteria

- A Sphere has a RuntimeProfile selecting provider + model; an agent override
  cannot exceed the Sphere-allowed providers.
- Ollama and OpenAI both implement the `AgentRuntime` port as adapters; the core
  imports neither SDK.
- A new Sphere defaults to local (Ollama); cloud is off until explicitly enabled
  via a high-risk, admin-only, approval-gated capability, and can be disabled
  entirely.
- Selecting/using a cloud provider for a minor profile is denied by default.
- Every cloud inference call is audited as an external transfer (data class,
  destination, consent, correlation id); API keys live in the secret store by
  reference and never appear in config, audit, or exports.
- Changing provider or model requires no memory migration and no policy change.
