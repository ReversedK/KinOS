# ADR-005 — Sphere Agent: Shared Space and Optional Collective Actor

## Status

Accepted for MVP.

## Context

If every member already has a personal agent, what is a Sphere agent (e.g. the "family agent") for, and is it even relevant? The open question was framed as: is the Sphere agent a **shared space** (each personal agent acts in it per its permissions) or a **persona** (a distinct collective agent)? Built naively as "a chatbot that knows the shared data", a persona is redundant — a personal agent could query shared memory just as well.

This must be settled without redundancy and without breaking invariants: agent boundaries stay visible and identities never merge (invariant 19); agents represent, they do not replace (invariant 17); the Sphere agent never receives private memory without authorization (results-contract §5).

## Decision

The Sphere agent is realized in two layers.

### 1. Shared space — the substrate (mandatory, MVP)

The Sphere owns shared memory, Sphere-scoped capabilities and policies. Personal agents act **into** this space according to their permissions. This is not a new concept — it is the Sphere's memory + capability bindings + policies already in the domain model. The shared space alone delivers the shared calendar, lists, projects, household knowledge, and cross-member coordination (via authorized projections such as free/busy).

### 2. Collective actor — an optional persona on top (later)

A persona is simply `Agent(owner = Sphere)` — an agent whose owner is the Sphere itself, operating in the same shared space with the shared scope as its memory-access profile. The domain model already allows this ("an Agent represents exactly one owner — a Member or a Sphere").

What the collective actor adds **that the shared space cannot**, and nothing more:

- **Initiative** — it acts on behalf of the collective when no member is acting (proactive reminders, surfacing conflicts, proposing). A shared space is passive.
- **A single, impartial counterpart** — an addressable "who" that answers with the collective's voice and advocates for no individual.
- **Acting outward as the Sphere** — representing the collective externally (with approvals), which a member's agent cannot do without acting as that member.

Everything else — shared memory, coordination, brokering availability — lives in the shared space and is reachable by personal agents. It does not require the persona.

### Dividing line

The persona is defined exactly by **proactivity + collective external agency**. Absent both, the shared space suffices and no persona is needed.

## Sequencing

- The shared space is the substrate and the **MVP**. results-contract §19 does not require a collective actor; it requires per-member agents plus the governance mechanics.
- The collective actor is an **optional increment** built on top, and must be built in this order: it has value only once the shared space and coordination capabilities exist, because it acts *through* them.
- Enabling a persona per Sphere is reversible and incremental. The choice does not have to be made now.

## Invariant alignment

- The collective actor represents the Sphere; it never claims to be a member and never replaces one (invariants 17, 19). Coordinating across personal agents never merges identities.
- It receives only shared-scope memory; never private memory without authorization (results-contract §5).
- It is policy-gated like any agent. Being owned by the Sphere grants it no special rights; approvals still apply to sensitive and external actions (invariants 6, 18).
- Cross-member coordination uses authorized projections (e.g. free/busy), never access to another member's private content.

## Consequences

- The "family agent" / Sphere agent is `Agent(owner = Sphere)` over the shared space — no separate mechanism, no new entity.
- The MVP ships the shared space + personal agents; the collective persona is deferred and optional.
- The only genuinely new capability the persona requires is **proactive triggering** (event/scheduled) plus the right to **act as the Sphere**; its proactivity model is to be specified when the persona is taken on.
- results-contract §5 and ADR-000 remain consistent: §5's "Sphere agent" is this optional collective actor running over the shared space.

## Open questions

- The proactivity model for the collective actor (what events/schedules may trigger it, and how its self-initiated actions are policy-gated and approval-bounded) — to be specified when the persona is implemented.
