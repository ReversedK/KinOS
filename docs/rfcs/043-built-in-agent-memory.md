# RFC-043 — Built-in agent memory (persist & recall across sessions, by default)

## Status

Accepted

## Summary

An agent cannot remember anything across sessions today: when you ask it to
"remember X", nothing persists once the session ends. Canonical memory (RFC-013,
durable in the Sphere store) and the `memory.capture` / `memory.search` capabilities
exist, but they are only wired when the **Shared Notes** package is installed,
enabled, granted, AND in the agent's scope. A fresh agent has none of that, so it has
no memory tool at all. Make **agent memory a built-in Sphere baseline**: every Sphere
carries default `memory.capture`/`memory.search` bindings and a default grant, and a
deployed agent gets memory in its scope by default — so "remember this" persists in
canonical memory and "what did I note about this" recalls it in a later session, with
no package to install.

## Motivation

Reported: "if I ask an agent to remember something, it doesn't persist outside the
session." Root cause (verified in code): `memory.*` bindings are provided *only* by
the `family-notes` / Shared Notes store package; the Sphere-MCP agent surface uses
only the Sphere's stored bindings, and a new agent's `enabledCapabilities` defaults to
`[]`. So an out-of-the-box agent is offered no memory tool, and any "memory" lives
only in the runtime's ephemeral session context (Hermes' native memory toolset is
governed off, RFC-025). Memory is a baseline capability of a personal/collective
agent, not an optional add-on — it should work by default and stay governed.

## Proposal

1. **Built-in memory bindings.** Add `defaultMemoryBindings()` (`memory.capture` →
   `local.memory_capture`, `memory.search` → `local.memory_search`, enabled, low
   risk) and include it wherever an agent's bindings are assembled — the Sphere-MCP
   `tools/list` surface and `tools/call`, and the capability-execute path — the same
   way provisioning/runtime-governance bindings are always available in code. Memory
   no longer depends on a stored package binding. The Shared Notes package (which also
   provides `memory.share`/`revoke_share`) is unchanged and still layers sharing on
   top.

2. **Default memory grant.** Seed a policy into every new Sphere: an adult/teen
   subject may `memory.capture` and `memory.search` (the catalog floor already denies
   children `capture`; `search` stays broadly readable and policy-scoped per item).
   An agent acts as its owner, so an agent owned by an adult/teen gets memory. Seeded
   in `defaultAdminPolicies` and **backfilled** onto pre-existing Spheres via the same
   lineage-guarded migration used for admin capabilities, so current agents gain
   memory without re-provisioning.

3. **Memory in the default agent scope.** When deploying an agent, include
   `memory.capture` and `memory.search` in the default `enabledCapabilities` (the
   wizard pre-selects them), so the agent is *offered* memory. Scope still narrows,
   deny-by-default; an admin can remove them.

4. **Signal persistence to the agent.** The capability descriptions surfaced as MCP
   tool descriptions say plainly that memory persists across sessions ("Remember a
   fact in durable memory (persists across sessions)" / "Recall facts from durable
   memory"), so the runtime uses them when asked to remember/recall.

Memory stays **canonical and governed** (ADR-002): captured as the owner's private
memory (durable in the store), retrieved policy-scoped per item, audited as security
facts (never content). Cross-session persistence is automatic because canonical
memory already outlives any runtime session.

## Domain impact

No new capability or entity — `memory.capture`/`memory.search` already exist. New:
`defaultMemoryBindings()` (a code default, like provisioning bindings), a seeded +
backfilled default grant policy, and memory in the default agent scope. Descriptions
clarified. The memory model, resolver, and floors are unchanged.

## Security and privacy impact

- **Private by default (ADR-002).** Remembered facts are the owner's *private*
  canonical memory; `memory.search` returns only what the subject may read
  (policy-scoped per item). An agent remembers for its owner, not the whole Sphere.
- **Minor-safety preserved.** The catalog floor still denies a child `memory.capture`
  (adults/teens only); `memory.search` stays policy-scoped. The default grant is
  adult/teen; invariant 8 holds.
- **Governed, not a prompt.** Memory is reached only through the Sphere MCP, each call
  policy-checked and RFC-027 scope-checked; audit records the security fact, never the
  remembered content (§18). Making it default changes availability, not the boundary.
- **Deny-by-default intact.** Memory is still a capability an admin can remove from an
  agent's scope or deny by policy; a child agent still cannot capture.

## Alternatives considered

- **Auto-install the Shared Notes package on Sphere creation.** Rejected — it couples
  a baseline (remembering) to an optional, uninstallable-later package, and installs
  sharing/revoke the operator may not want. A built-in binding + grant is lighter and
  always-on.
- **Agent-owned memory namespace (`ownerType: "agent"`).** Deferred — member-owned
  private memory already delivers cross-session persistence and reuses the resolver.
  A per-agent namespace is a possible refinement, not required for the fix.
- **Rely on the runtime's native memory.** Rejected — Hermes' native memory is
  governed off (RFC-025, invariant 2: canonical memory is served via the Sphere MCP),
  and it wouldn't be governed or portable. Memory must be KinOS canonical memory.

## Acceptance criteria

- A newly created Sphere offers `memory.capture`/`memory.search` to an agent in scope
  **without** installing any package.
- An agent asked to remember a fact persists it (a `MemoryItem` in the store); a later
  session's `memory.search` recalls it — verified live end to end.
- A pre-existing Sphere gains the default memory grant via backfill (its agents can
  remember without re-provisioning).
- A child-owned agent is still denied `memory.capture` (floor); search stays
  policy-scoped; audit records no content.
- The deploy wizard includes memory in the default scope; it remains removable.
