# RFC-007 — Hermes as a Governed Runtime: Sphere MCP and Configuration Projection

## Status

Accepted

## Summary

KinOS adopts **Hermes** (Nous Research) as a rich agent runtime — not merely an
inference adapter (RFC-004) but a full agent platform with its own skills,
private session memory, native tools, MCP client, multi-channel messaging and
cron. KinOS governs Hermes **at the boundary, not in its internals**, through
three mechanisms:

1. a **single MCP server per Sphere** that KinOS exposes to Hermes, whose tools
   are policy-checked capabilities (memory, connectors, installed packages),
   **permissioned per calling-agent identity**;
2. a **projection of Sphere configuration onto Hermes' `~/.hermes/config.yaml`**
   — provider/model, the one Sphere MCP, an `allowed_tools` surface, native-tool
   allow-lists, channel wiring;
3. a **local-first, encrypted, restorable backup of each Hermes agent's session
   state**, treated as opaque runtime state distinct from canonical memory.

Hermes keeps its richness; KinOS keeps authorization, memory canonicity and
audit. Replacing Hermes with another runtime must remain boring (no policy,
memory or capability migration).

## Motivation

ADR-001 names Hermes the reference MVP runtime and integration-model.md already
states a Hermes tool is "never offered to an agent directly … only surfaced
after a policy check". RFC-004 wired Hermes' *inference* behind the
`AgentRuntime` port. But Hermes is much more than inference: it manages skills,
sessions, its own memory, MCP servers, messaging gateways (WhatsApp, Telegram,
Signal, …) and a cron scheduler. None of that richer surface is defined by an
accepted document, so per the governing rule (`README.md`, `CLAUDE.md`) it
cannot be implemented yet.

The naive integrations all break invariants: Hermes owning cross-session memory
(invariants 2, 26 — the runtime never owns memory), Hermes self-installing MCP
servers (RFC-002 — packages are curated, signed, sandboxed, policy-gated), or
Hermes exposing native tools directly to the agent (ADR-001 — only policy-scoped
tools reach the runtime). This RFC defines how Hermes is configured *by* a Sphere
so its power is usable without weakening the contracts.

Research note: Hermes stores config in `~/.hermes/config.yaml`; MCP servers are
**disabled by default**; per-server tool surfaces are restricted via
`tools.include`/`tools.exclude`/`allowed_tools`; it supports command approval,
authorization and container isolation. These native controls map almost 1:1 onto
KinOS governance, which is what makes this RFC tractable.

## Proposal

### Deployment — one container, many agents via Hermes profiles

Hermes runs in **its own container** in the KinOS Docker infrastructure. A
**single Hermes install serves many agents** through its native **profiles**
mechanism — no second install or image per agent:

- A profile is a separate Hermes home (`~/.hermes/<profile>/`) with its **own**
  `config.yaml`, `.env`, `SOUL.md`, memories, sessions, skills, cron jobs and
  state DB. Profiles are fully isolated; sessions are namespaced
  `agent:<profile>:…` so two profiles never collide.
- **One Hermes profile per principal** (the "one agent per principal" of the
  identity model). KinOS provisions and configures one profile per agent.
- **Process model: a single multiplexing gateway.** Hermes' default is one
  process per profile, but for "a container deployment where one process per
  profile is operationally heavy" it supports a **single multiplexing gateway** —
  one inbound process serves messages for every profile on the box. KinOS uses
  this: **one container, one gateway process, many profiles**.
- **Credential isolation holds under multiplexing.** Per-profile `.env` keys are
  resolved from the profile's own scope and never unioned into a shared
  environment. Authorization therefore stays per-profile even though one process
  multiplexes transport: each profile authenticates to the Sphere MCP with its
  **own profile-scoped token**. KinOS governs at the profile/MCP layer, never at
  the process layer.

This makes the per-agent token, per-agent config projection and per-agent session
backup below concrete: they are **per-profile**.

### Sphere MCP — the governed gateway

KinOS exposes **one MCP server per Sphere**. It is the single tool surface KinOS
registers in each Hermes agent's config. Its tools are not raw provider tools;
each is a **capability** (ADR-001, integration-model.md): `memory.search`,
`memory.write`, the Sphere's connector capabilities, and the capabilities of
installed packages (RFC-002).

The Sphere MCP is **permissioned per calling-agent identity**:

- Each Hermes agent instance authenticates to the Sphere MCP with **its own
  token**, carried as a secret reference in the projected config (never the
  value — `secret-store.md`).
- On every call: `token → agent identity → Identity Resolver → Policy Engine →
  Memory/Capability Resolver → authorized result only`. Two agents calling the
  same Sphere MCP see different authorized surfaces.
- Authorization is anchored to the **agent credential**, never to an identity
  asserted per-message inside the runtime. This preserves "Identity Resolver is
  first" and "the prompt is never the boundary" (coding principles 2, 4).

This is exactly ADR-001's "concrete, scoped tool list via bindings", realized as
an MCP server rather than an in-process list. The per-call policy re-check
(ADR-001 §"Capability resolution and double-check") still applies: the offered
tool set is the first filter, the per-call policy decision is the enforced one.

### Configuration projection — Sphere config → `~/.hermes/config.yaml`

KinOS **owns** each Hermes profile's `config.yaml` and `.env`; the projected
config is the source of truth. The agent does not edit its own governance config.
One projection is written per profile (one per principal). Projection covers:

```ts
type HermesConfigProjection = {
  runtime: RuntimeProfile;              // RFC-004: provider/model, secretRef
  mcpServers: [{
    name: 'sphere';                     // the ONE Sphere MCP, and only this one
    transport: SphereMcpEndpoint;       // local-first endpoint
    authSecretRef: string;              // per-agent token (secret-store ref)
    allowedTools: string[];             // = capabilities the policy authorizes
  }];
  nativeTools: { allow: string[] };     // deny-by-default allow-list of Hermes-native tools
  channels: ChannelBinding[];           // see "Messaging channels"
  autonomousMcpInstall: false;          // KinOS owns the MCP surface
};
```

Consequences of the projection:

- **No MCP self-install in practice.** Hermes' MCP servers are disabled by
  default; KinOS registers only the Sphere MCP and never writes others, so
  "disable installation of new MCPs" is an *emergent property* of owning the
  config, not a bespoke flag.
- `allowedTools` is set from the capabilities the Policy Engine authorizes for
  that agent, deny-by-default (coding principle 6).
- Provider/model selection remains governed by RFC-004 (cloud is an external
  transfer, off by default, denied for minors).

### Memory — private session vs canonical Sphere memory

Two distinct things, deliberately not merged:

- **Hermes session memory** is **private and internal to Hermes** — runtime-local
  working state, in the spirit of ADR-002's "chat logs are not memory by
  default". It is **non-canonical**: KinOS does not own, read or govern its
  content as Sphere memory.
- **Canonical memory** is the Sphere's memory (ADR-002 Memory Items), reached by
  the agent *only* through the Sphere MCP's `memory.*` capabilities, policy-scoped
  per identity. This is the portable, governed, runtime-independent memory.

Promotion from the first to the second is the existing, explicit/policy-driven
**conversation→Memory Item extraction** (ADR-002 §"Conversation-to-memory
extraction"): it creates a `source: 'conversation'` item, `private` by default,
never auto-shared.

#### Session backup (restorable)

KinOS periodically backs up **each Hermes profile directory**
(`~/.hermes/<profile>/` — its sessions, memories, skills and state DB) as a
**restorable snapshot**:

- **local-first** (ADR-006), **encrypted** via the secret store;
- an **opaque blob**: KinOS backs up and restores without reading its content;
  audit records the *fact* of backup/restore with a correlation id, never session
  content (invariant 16);
- `backup` and `restore` are **governed, audited** actions (admin/owner);
- it provides **Hermes continuity** (crash, restart, agent migration); it is
  **not** a substitute for canonical-memory portability. The snapshot is
  Hermes-format-bound and does not guarantee restoration into a *different*
  runtime — cross-runtime portability stays the job of canonical Sphere memory.
- This **extends** the export/portability model (results-contract §17).

### Native tools — controlled, not forbidden

Hermes-native tools are allowed but governed by a **deny-by-default allow-list**
in the projected config (`nativeTools.allow`). A native tool that performs an
external transfer or a sensitive action must be surfaced as a capability and
policy-checked like any other; the allow-list never becomes a back door around
the Policy Engine (integration-model.md counter-examples).

### Messaging channels

A person must be able to reach their agent over WhatsApp, Telegram, Signal, etc.
**The channel↔identity binding is handled by Hermes** (it routes a channel to the
right principal/agent). KinOS does not govern the channel; it governs **what the
agent may do** via the Sphere MCP permissions. The governance anchor remains the
per-agent token, so channel routing being Hermes' concern does not widen
authorization. This is realized as **one Hermes profile per principal**, each
with its own profile-scoped token and policy scope, reachable through the single
multiplexing gateway.

### Cron and proactivity

Hermes' cron may trigger sessions, but any action it takes is an ordinary
capability call through the Sphere MCP and is policy-checked (and approval-gated
where required). Proactive, self-initiated collective action remains the
deferred concern of ADR-005 (the optional collective actor); this RFC adds no new
proactivity rights.

## Domain impact

- New configuration concept **HermesConfigProjection** derived from Sphere
  config; to be reflected in `domain-model.md` as Sphere runtime configuration
  (alongside RFC-004's RuntimeProfile).
- New concept **Sphere MCP**: a governed MCP endpoint per Sphere whose tools are
  capabilities; an architectural realization of ADR-001's scoped tool list, to be
  noted in `integration-model.md`.
- New governed capabilities (high-risk, admin/owner, approval-gated):
  `runtime.session.backup`, `runtime.session.restore`, and a
  `runtime.config.project` action that (re)writes a Hermes agent's config from
  Sphere config.
- No change to memory canonicity, policy evaluation, or capability semantics.
  Hermes session memory is explicitly out of the canonical Memory Item model.

## Security and privacy impact

- **Runtime decides nothing** (invariant 28, ADR-001): all authorization is the
  Sphere MCP's policy check; Hermes executes.
- **Memory canonical; runtime owns no canonical memory** (invariants 2, 26):
  session memory is non-canonical runtime state; governed memory only via MCP.
- **Deny by default** (coding principle 6): `allowedTools` and `nativeTools.allow`
  are allow-lists; absent config means no surface.
- **No autonomous MCP install** (RFC-002): KinOS owns the config and registers
  only the Sphere MCP; new MCPs arrive only via the curated, signed, sandboxed
  package store.
- **External transfer** (invariant 14): cloud inference (RFC-004) and any native
  tool/connector leaving the device are audited with data class, destination,
  consent and correlation id — never content.
- **Audit minimally** (invariant 16): config projection, backup, restore and tool
  calls are recorded as security facts; session content and prompts are not.
- **Identity first** (coding principles 2, 4): authorization anchored to the
  per-agent token, not to a runtime-asserted per-message identity.

## Alternatives considered

- **Treat Hermes purely as an inference adapter (RFC-004 only).** Rejected: it
  ignores Hermes' skills/sessions/MCP/messaging, which are the reason to use
  Hermes at all, and leaves their governance undefined.
- **Let KinOS absorb Hermes' memory, skills and MCP management.** Rejected:
  duplicates Hermes, fights the runtime instead of governing it, and risks making
  the runtime own memory; the boundary (MCP + config projection) is the minimal
  governed seam.
- **One MCP server per agent.** Rejected in favor of **one per Sphere,
  permissioned per caller**: differentiation stays inside KinOS (where governance
  belongs) with one MCP lifecycle per Sphere; a per-agent server multiplies
  deployment surface for no governance gain.
- **Block messaging channels until KinOS resolves channel identity.** Rejected:
  channel↔identity is Hermes' routing concern; KinOS governs via MCP permissions
  anchored on the agent token, so blocking channels adds no security.
- **Make Hermes session memory canonical/portable.** Rejected: it would force
  KinOS to read and govern private session content and bind portability to the
  Hermes format. Instead, session state is backed up as an opaque restorable blob,
  and canonical memory stays in the Sphere model.

## Open questions

- Exact set of Hermes-native tools placed in the MVP `nativeTools.allow` list.
- Resource governance for the multiplexing gateway: per-profile vs global
  `max_concurrent_sessions` caps, and fairness/isolation under load when one
  process serves many profiles.
- Backup cadence, retention window, and whether restore may target a different
  Hermes version (format-compatibility policy).
- Sphere MCP transport detail (local socket vs loopback HTTP) and how the
  per-agent token is provisioned and rotated through the secret store.
- Whether `allowedTools` must be re-projected eagerly on policy change or resolved
  lazily at call time (the per-call policy re-check makes lazy safe; eager
  reduces offered-but-denied surface).
- Per-capability provider routing interaction with RFC-004's open question.

## Acceptance criteria

- A **single Hermes install in one container** serves multiple agents via
  **profiles** (one profile per principal), with isolated config/memory/sessions
  per profile and a **single multiplexing gateway** as the sole inbound process.
- A Sphere exposes exactly **one** MCP server whose tools are capabilities;
  each Hermes agent authenticates with its own token, and the MCP returns only the
  capabilities/memory the Policy Engine authorizes for that agent identity.
- A Hermes agent's `~/.hermes/config.yaml` is **projected from Sphere config** by
  KinOS (provider/model, the single Sphere MCP, `allowedTools`, native-tool
  allow-list); the agent cannot widen its own governance config.
- No MCP server other than the Sphere MCP is registered; new MCP capabilities
  arrive only through the RFC-002 package store.
- Hermes session memory is treated as non-canonical runtime state; durable
  governed memory exists only as Sphere Memory Items reached via the MCP, with
  conversation→Memory Item extraction remaining explicit/policy-driven.
- Each Hermes agent's session state is backed up local-first, encrypted, as an
  opaque blob, and is restorable; backup/restore are governed, audited actions
  under a correlation id and record no session content.
- Native tools are exposed only via a deny-by-default allow-list and never bypass
  the Policy Engine; cron-triggered actions are policy-checked like any call.
- Replacing Hermes with another runtime requires no policy, memory or capability
  migration (coding principle 9).
