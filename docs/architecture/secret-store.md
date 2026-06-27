# KinOS — Secret Store

## Purpose

Integrations need credentials: API keys, OAuth tokens, passwords, connection strings. KinOS must hold these without letting them leak into the domain core, into agents, into prompts, into memory or into audit logs.

This document defines how secrets are stored, referenced, resolved and retired. It is the authoritative home for credential handling referenced by `docs/architecture/integration-model.md`, `docs/domain/domain-model.md` (the Integration entity's "credentials reference") and `docs/contracts/results-contract.md` §12.

## Principles

- **Secrets live outside the domain.** No domain entity stores a secret value. The Integration entity stores a `secretRef`, never the credential itself.
- **Reference, not value.** Domain logic, capability bindings, policies and events carry an opaque `secretRef`. The value is resolved only at the execution boundary, just in time, for an authorized capability call.
- **The store is an adapter.** The concrete backend (local encrypted store, OS keychain, a vault service) is replaceable and provider-agnostic. The domain depends on the secret-store interface, never on a specific provider.
- **Local-first.** A local encrypted store must work offline with no mandatory cloud KMS. A remote secret backend is an optional extension requiring explicit activation.
- **Encrypted at rest.** Secret values are encrypted at rest; the encryption key is managed outside the domain database.
- **Per-Sphere isolation.** A `secretRef` is scoped to one Sphere (and one integration). One Sphere's secrets are never resolvable from another Sphere's context.
- **Least exposure.** Only the integration adapter executing an authorized capability binding may resolve a secret. Agents, models and prompts never receive secret values. A resolved secret is held only for the duration of the call and is never written to memory or audit.

## Reference model

```ts
// A secret is owned by an integration, or (ADR-007) by an agent runtime — the
// per-agent Sphere-MCP access token. The owner kind scopes resolution.
type SecretOwner =
  | { kind: 'integration'; integrationId: string }
  | { kind: 'agent-runtime'; agentId: string };

type SecretRef = {
  id: string;            // opaque, stable; what the domain stores and passes
  sphereId: string;      // owning Sphere; resolution is denied outside it
  owner: SecretOwner;    // owning integration, or owning agent runtime (ADR-007)
  scopes: string[];      // human-readable scopes, e.g. ['calendar.read']; visible to admins
  status: 'active' | 'rotating' | 'revoked';
};
```

> ADR-007 (accepted) adds the `agent-runtime` owner kind for the per-agent Sphere
> MCP token. Such a token *authenticates* an agent to the Sphere MCP but carries
> no authority of its own — authorization remains the Policy Engine's per-call
> decision. Its value lands only in the secret store and the agent's KinOS-owned
> runtime profile; the domain holds only the `secretRef`. All other rules in this
> document (per-Sphere isolation, least exposure, encrypted at rest, lifecycle,
> rotation keeping `id` stable, fail-closed resolution) apply unchanged.

The domain stores and moves `SecretRef.id`. Resolution to a value happens only inside the secret store, invoked by the integration adapter at call time:

```text
capability execution (authorized by Policy Engine)
  -> Capability Binding selects integration adapter
  -> adapter requests secret value by secretRef, in Sphere context
  -> secret store checks Sphere/integration match, returns value to the adapter only
  -> adapter calls the external service
```

If the Sphere or integration context does not match the `SecretRef`, resolution is denied. Resolution failure fails closed: the capability execution is denied, not retried with a guessed credential.

## Visibility

Administrators can see what exists and what it can do, never the value:

- the set of integrations and their `secretRef`s per Sphere;
- the declared scopes of each secret;
- usage facts (which capability used which integration, by correlation id) per `docs/architecture/event-model.md`.

Administrators cannot read raw secret values through any API. There is no "reveal secret" capability.

## External transfer

Using a secret to call an external service is, by definition, an external transfer. It is subject to external-transfer evaluation and audit (`docs/security/privacy-model.md`, invariant 14): KinOS must know what data is sent, to which service, under which consent, for which capability. The audit records the transfer as a security fact and references the `secretRef` by id — never the secret value.

## Lifecycle

A secret moves through `active → (rotating) → active` and `active → revoked`.

- **store** — a credential is captured (e.g. after an OAuth flow) and written to the secret store; the domain receives only a new `secretRef`.
- **rotate** — the value is replaced; `status` is `rotating` during the swap, then `active`. **The `secretRef.id` does not change**, so bindings and policies need no edits across rotation.
- **revoke / disconnect** — the value is removed and `status` becomes `revoked`; future resolution is denied. Maps to the `integration.disable` / disconnect-credentials capabilities. Past usage remains in audit as facts; revocation blocks the future, not the past (invariant 5).
- **delete** — on integration removal or Sphere deletion, secret values are purged; the `secretRef` and its audit references may be retained as history without the value.

## Non-goals (MVP)

- a specific vault product choice;
- hardware security modules;
- automatic scheduled rotation;
- secret sharing across Spheres.

## Acceptance criteria

- No domain entity, prompt, memory item or audit event ever contains a secret value.
- Domain code references secrets only by `secretRef`; values resolve only inside the secret store at call time.
- A secret resolves only in its owning Sphere and integration context; mismatches and failures fail closed.
- Rotation replaces a value without changing its `secretRef` or any binding/policy.
- Revocation blocks future resolution immediately while past usage remains as audit facts.
- Administrators can see scopes and usage, never raw values; no API reveals a secret.
