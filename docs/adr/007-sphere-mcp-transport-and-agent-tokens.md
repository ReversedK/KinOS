# ADR-007 — Sphere MCP Transport and Per-Agent Token Provisioning

## Status

Accepted

## Context

RFC-007 (accepted) defines **Hermes as a governed runtime**: one MCP server per
Sphere (the "Sphere MCP"), permissioned per calling-agent identity, plus a
per-agent configuration projection. The governed **dispatch** behind that gateway
is implemented and tested in the domain core (`handleSphereMcpCall`,
`projectAgentRuntimeConfig`): a call resolves
`credential → agent identity → Policy Engine → authorized result only`, with the
subject anchored to the credential and unknown credentials refused before any
policy check.

RFC-007 deliberately left two items in **§Open questions**, and the governing
rule (`README.md`, `CLAUDE.md`) forbids implementing them until an accepted
document decides them:

1. **Sphere MCP transport detail** — local socket vs loopback HTTP, and how the
   per-agent token is presented.
2. **Per-agent token provisioning and rotation through the secret store.**

These are the only blockers for the Sphere MCP **server transport** and the
mutating runtime-governance endpoints (`runtime.config.project`,
`runtime.session.backup`/`restore`). This ADR settles both, consistently with
ADR-001 (domain/runtime separation), ADR-006 (stack: TypeScript + Docker,
local-first), `secret-store.md` (credentials by reference), and the invariants
(deny by default, secrets never in domain/prompt/memory/audit, audit minimally).

The deployment frame from RFC-007 and ADR-006: KinOS and Hermes each run in their
own container under one `docker compose` project. A single Hermes install serves
many agents via **profiles** behind a **single multiplexing gateway**;
per-profile `.env` keys are never unioned into a shared environment, so
authorization stays per-profile even under multiplexing.

## Decision

### 1. Transport: private MCP, authenticated by token, never the transport

The Sphere MCP is served **by KinOS** and consumed by Hermes. The transport is
chosen for locality but is **never the security boundary** — the per-agent token
is (deny by default). Concretely:

- **Co-located (same host / shared volume): a Unix domain socket** under a
  KinOS-owned directory, one socket per Sphere
  (`…/run/kinos/<sphereId>/sphere-mcp.sock`), `0700`-scoped. Preferred: no
  network surface at all.
- **Separate containers (the ADR-006 compose default): MCP Streamable HTTP bound
  to the private compose network only** (e.g. `http://kinos:PORT/mcp/<sphereId>`),
  **never published to the host or beyond**. No `ports:` mapping; reachable only
  on the internal bridge network.
- **Identical security model on either transport.** Every request carries a
  per-agent **bearer token** (`Authorization: Bearer <token>`). The transport
  decides reachability; the token decides identity; the Policy Engine decides
  authorization. A request without a resolvable token is rejected before any
  policy evaluation (already enforced by `handleSphereMcpCall`).
- **One gateway lifecycle per Sphere** (RFC-007): the Sphere MCP server is
  created/torn down with the Sphere, not per agent.

Rationale: a Unix socket is the strongest local-first default (no listening
port); but ADR-006's two-container layout needs a network hop, so private-network
Streamable HTTP is the portable fallback. Making the **token** the boundary means
the transport choice is an operational detail, not a security decision, and can
change without touching governance.

### 2. The per-agent token is a secret-store credential

Each agent (Hermes profile) is issued one **Sphere-MCP access token**: a
high-entropy random bearer secret. It authenticates the agent to the Sphere MCP;
**it carries no authority of its own** — it only identifies the caller, and all
authorization remains the per-call policy check anchored to the resolved
identity.

The token is a first-class **secret-store** secret (`secret-store.md`), so the
existing guarantees apply unchanged: value encrypted at rest, never in the domain
/ prompt / memory / audit, resolvable only in its owning Sphere, fail-closed on
mismatch. The projection already carries `gateway.authSecretRef` — a `secretRef`,
never the value.

**Amendment to `secret-store.md` (small, additive):** `SecretRef` today is owned
by an *integration*. Add an **owner kind** so a token can be owned by an
*agent runtime* instead:

```ts
type SecretOwner =
  | { kind: 'integration'; integrationId: string }
  | { kind: 'agent-runtime'; agentId: string }; // Sphere-MCP token

type SecretRef = {
  id: string;            // opaque, stable; what the domain stores and passes
  sphereId: string;      // owning Sphere; resolution denied outside it
  owner: SecretOwner;    // was: integrationId
  scopes: string[];      // human-readable; for an MCP token, the projected allowedTools
  status: 'active' | 'rotating' | 'revoked';
};
```

Everything else in `secret-store.md` (per-Sphere isolation, least exposure,
encrypted at rest, lifecycle) is inherited verbatim.

### 3. Provisioning (at projection time, governed)

Minting a token happens **inside `runtime.config.project`** (RFC-007's governed,
approval-gated capability) — provisioning is never a side effect of a chat turn:

1. The admin invokes `runtime.config.project` for an agent (Policy Engine +
   approval floor; audited under a correlation id).
2. KinOS ensures a Sphere-MCP `SecretRef` exists for `{ sphereId, agentId }`; if
   absent, it **mints** a token value, stores it (secret store), and obtains a
   stable `secretRef.id`.
3. KinOS writes the value into **exactly one place**: the agent's **profile
   `.env`** (owned by KinOS), via the secret store at projection time. This is
   the per-profile credential isolation RFC-007 relies on. The value never enters
   any domain entity, the projected `config.yaml`, audit, memory or a prompt.
4. The projected config references the token only by `authSecretRef`
   (= `secretRef.id`).

### 4. Resolution at the MCP boundary (token → agent, fail-closed)

`handleSphereMcpCall` already takes a `resolveAgentByToken` port. Its adapter:

- Holds a **token-lookup index** mapping a **one-way hash** of the presented
  token (e.g. SHA-256) → `{ agentId, sphereId }`. The index stores the **hash,
  never the plaintext token**; the raw value lives only in the secret store and
  the profile `.env`.
- On a call: hash the presented bearer → look up → if found and the secret's
  `status` is `active`, return the agent identity; otherwise return `undefined`
  (the gateway then refuses **before any policy check**). Revoked/rotating-out
  hashes resolve to nothing → fail closed.
- The index is **per Sphere** (a token from Sphere A never resolves in Sphere B),
  matching secret-store per-Sphere isolation.

### 5. Rotation and revocation (reuse the secret-store lifecycle)

- **Rotate** (`active → rotating → active`): mint a new value, write it to the
  secret store and the profile `.env`, add the new hash to the index, then
  invalidate the old hash. **`secretRef.id` does not change**, so the projection,
  bindings and policies need no edits (secret-store invariant). A short overlap
  window may keep both hashes valid to avoid a dropped in-flight call; the old
  hash is removed once the new value is in the profile.
- **Revoke** (`active → revoked`, e.g. on `agent.disabled` or a compromised
  token): remove the hash from the index immediately → all future calls fail
  closed. Past usage remains in audit as facts (invariant 5: revocation blocks
  the future, not the past).
- **MVP non-goal:** automatic scheduled rotation (matches `secret-store.md`
  non-goals); rotation is an explicit governed action.

### 6. Audit (minimally)

Provisioning, rotation, revocation and every MCP call are recorded as **security
facts** under a correlation id — `secretRef.id`, agentId, capability, decision,
deciding policy — and **never** the token value, the resolved secret, or call
content (invariant 16). New audit facts: `runtime.token.provisioned`,
`runtime.token.rotated`, `runtime.token.revoked` (event-model addition).

## Consequences

- **Unblocks** RFC-007 task #8 (Sphere MCP server transport) and task #7
  (mutating runtime-governance endpoints + admin UI): both can now be built on the
  already-tested core dispatch without inventing un-specified semantics.
- The **transport is replaceable** (socket ↔ private HTTP) with no governance
  change — the token, not the transport, is the boundary (coding principle 1;
  ADR-001 binding replaceability).
- **No new trust in the runtime.** The token authenticates; the Policy Engine
  authorizes. A stolen token still buys only that agent's already-policy-scoped
  surface, re-checked per call (defence in depth).
- **Secrets stay by reference.** The only plaintext landing spot is the
  KinOS-owned profile `.env`; the domain, projection, audit and memory hold only
  `secretRef.id` and hashes (invariants 16, 27; `secret-store.md`).
- **Boring runtime swap preserved.** Replacing Hermes needs no token or policy
  migration: tokens are per-agent secret-store entries, not Hermes-specific
  (coding principle 9).
- **Cost:** a small additive amendment to `secret-store.md` (owner kind) and the
  event model (three token facts); a token-hash index adapter; profile `.env`
  writing at projection time.

## Non-goals

- Choosing the concrete secret-store backend (local encrypted file vs keychain vs
  vault) — unchanged from `secret-store.md`; this ADR only adds the owner kind.
- Automatic scheduled token rotation, HSMs, cross-Sphere tokens.
- The full MCP tool schema / capability-to-tool naming on the wire (follows
  `integration-model.md` and per-slice acceptance criteria).
- Channel↔identity binding (WhatsApp/Telegram/…): RFC-007 leaves this to Hermes;
  the governance anchor remains the per-agent token.

## Acceptance criteria

- The Sphere MCP is reachable only privately (Unix socket when co-located, else
  private-network Streamable HTTP), never published to the host or beyond; every
  request is authenticated by a per-agent bearer token.
- Each agent has exactly one Sphere-MCP `SecretRef` (`owner.kind = 'agent-runtime'`),
  scoped to its Sphere; the projected config references it only by id.
- The token value exists only in the secret store and the agent's KinOS-owned
  profile `.env`; it never appears in a domain entity, the projected
  `config.yaml`, a prompt, memory or audit.
- An unknown, revoked, or wrong-Sphere token resolves to no identity and the
  gateway refuses before any policy check (fail closed).
- Rotation replaces the value without changing `secretRef.id` or any
  projection/binding/policy; revocation blocks future calls immediately while past
  usage remains as audit facts.
- Provisioning, rotation, revocation and MCP calls are audited as security facts
  under a correlation id, never carrying the token value or call content.
- Replacing Hermes with another runtime requires no token, policy, memory or
  capability migration.
