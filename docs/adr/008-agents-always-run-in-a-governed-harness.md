# ADR-008 — Agents Always Run Inside a Governed Harness

## Status

Accepted

## Context

The word "runtime" has been carrying two different meanings in KinOS, and the
conflation is now causing design confusion (it surfaced while wiring the governed
per-agent model, RFC-009):

1. **Inference runtime** — the thing that *generates tokens* for a prompt. This is
   the `AgentRuntime` port (`packages/core/src/runtime/runtime.ts`), implemented by
   provider adapters (Ollama, OpenAI, or Hermes-as-inference). RFC-004 governs the
   provider/model choice here. It is a **text-completion** boundary.
2. **Agent execution environment** — the thing an agent actually *runs inside*: the
   agentic loop that plans, calls tools, and holds working state. RFC-007 defines
   **Hermes** in this role: a governed runtime that reaches back into KinOS through
   the **Sphere MCP** for exactly its policy-authorized capabilities, with a
   per-agent configuration projection (RFC-007) and per-agent token (ADR-007).

These are not the same thing: (2) *uses* (1) as its text backend. Today the `/chat`
test bench drives (1) directly (Ollama by default) with the governance pipeline
running in the KinOS core; the full (2) loop (Hermes running the agent, calling the
Sphere MCP) is a separate path.

The product position we now settle: **an agent must never execute "bare" — it
always runs inside a governed execution environment that has no authority of its
own and reaches capabilities only through the Sphere MCP.** We name that
environment the **Harness**. Hermes is the only Harness that exists today, but the
architecture must depend on the *role*, not on Hermes — consistent with ADR-001
(domain/runtime separation), invariant 12 and coding principle 1 (providers/runtimes
stay replaceable adapters, never a domain dependency), and the invariants that keep
governance upstream of the runtime ("the runtime is a second line of defense, not
the first"; "a prompt must never be the privacy boundary").

This ADR does not change *what* is governed or *where* (that stays the Policy
Engine, upstream). It settles *how agents execute*: always through a Harness.

## Decision

### 1. The Harness is a first-class, replaceable role

A **Harness** is the governed environment an agent runs inside. It is defined by a
contract, not by a product:

- It executes **downstream of the governance pipeline**. It receives only an
  **already-governed projection** — the agent's authorized capability/tool surface,
  its governed model, and its per-agent credential (RFC-007 projection, ADR-007
  token). It never computes its own authorization.
- It holds **no ambient authority**. It reaches every capability **exclusively
  through the Sphere MCP**, where each call is policy-checked per call, anchored to
  the agent's token identity (ADR-007). It never calls a tool, integration, or
  model on its own account or from a bare environment.
- It is **authenticated per agent** (the ADR-007 Sphere-MCP token); one profile per
  agent, no shared ambient environment.

The domain depends on this **Harness role** (projection contract + Sphere MCP +
token), never on a specific harness implementation.

### 2. Every agent runs inside a Harness — no bare/direct execution

A deployed, live agent **always** executes inside a Harness. An agent never:

- calls an inference provider directly as itself, nor
- calls a tool / integration / capability directly,

outside a Harness. Its only path to acting in the world is: *run in the Harness →
request a capability → Sphere MCP → Policy Engine → authorized result only*. Bare
agent execution (an agent process talking straight to a model or an integration) is
disallowed by construction.

### 3. Hermes is the sole MVP Harness; it is an adapter, not the design

**Hermes is the only Harness available today**, and the reference implementation of
the role (RFC-007). It is an **adapter behind the role**:

- The domain core imports nothing Hermes-specific (coding principle 1; invariant
  12). "Hermes" appears only in adapters and deployment, never in domain reasoning,
  policy, memory, or audit semantics.
- Replacing Hermes, or adding a second Harness, requires **no** policy, memory,
  capability, or token migration — a "boring" swap (coding principle 9): tokens are
  per-agent secret-store entries (ADR-007), the projection is provider-agnostic, and
  the Sphere MCP contract is unchanged.

### 4. Harness ≠ inference; the governed model is projected *into* the Harness

The Harness (execution) and the inference runtime (token generation) are distinct
layers. A Harness *uses* an inference backend (e.g. Hermes → Ollama or OpenAI).
Therefore:

- The **provider/model choice remains RFC-004**, and the **per-agent governed
  model remains RFC-009** — decided in the core Policy Engine.
- That governed per-agent model is **projected into the Harness profile** (RFC-007
  projection), so the Harness runs the agent on exactly the model KinOS decided —
  never a Harness-local default. Which Harness runs the agent is orthogonal to which
  model/provider it uses.

### 5. The Harness is never the governance boundary

Governance is decided in the **Policy Engine, before projection**. The Harness
profile is a **projection of already-made decisions**, not their source. Restating
the standing invariants for this layer:

- Only policy-authorized memory and the policy-authorized capability surface are
  ever projected to the Harness; the prompt/profile is never the privacy or
  authorization boundary (coding principles 2 & 4).
- A compromised or misbehaving Harness buys only the agent's **already
  policy-scoped** surface, re-checked **per call** at the Sphere MCP (defence in
  depth) — it can never widen access by editing its own profile or prompt.

### 6. The direct-inference path is test/dev only, not agent execution

The current `/chat` path that calls the `AgentRuntime` (inference) port directly is
retained **only** as:

- a Harness's inference backend (internal to the Harness), and
- a **dev/test harness** for exercising the governance pipeline + inference in
  isolation (unit tests, local smoke tests).

It is **not** a production agent-execution path and must not be presented as an
agent "running". Live agent execution goes through a Harness (§2). Migrating the
operator console's real-condition testing to drive the Hermes Harness (rather than
direct inference) is the follow-up this ADR authorizes; until then the direct path
is explicitly labelled test-mode.

## Consequences

- **Terminology is fixed.** "Harness" = governed agent execution environment;
  "inference runtime / provider" = the `AgentRuntime` text backend; "governance" =
  the Policy Engine. The misleading equation *governed = the Hermes profile* is
  rejected: the profile is a projection, not the boundary.
- **The domain stays Hermes-free.** Hermes is one adapter behind the Harness role;
  a second Harness can be added later with no domain/policy/memory/token change
  (ADR-001, ADR-007, coding principle 9).
- **RFC-009 is completed end-to-end.** The governed per-agent model reaches the
  Harness profile via the RFC-007 projection (now wired), so both the inference path
  and the Harness run on the decided model.
- **Deployment stance.** The compose deployment ships a Hermes Harness and runs
  agents through it; "always a Harness" is enforced by (a) this architectural rule —
  no code path executes a live agent outside a Harness — and (b) deployment
  configuration selecting Hermes. It is not baked into the domain core.
- **Known gap to close (honest).** The operator console's `/chat` currently drives
  inference directly, i.e. it does not yet exercise the full Hermes Harness loop.
  This ADR reclassifies that path as test-mode and authorizes migrating live agent
  testing onto the Harness; the gap is tracked, not hidden.
- **Cost.** Introduce the "Harness" term in `domain-model.md` /
  `docs/architecture/` and reconcile the "runtime" wording; a follow-up slice to run
  the console's real-condition testing through the Hermes Harness; an optional later
  rename of the `AgentRuntime` port to make "inference" explicit (deferred to avoid
  churn — naming note only, no behaviour change).

## Non-goals

- Specifying or building a **second** Harness now (Hermes is the sole MVP harness).
- Changing the **inference provider/model** model (RFC-004) or the **Sphere MCP /
  per-agent token** mechanics (RFC-007, ADR-007) — both are inherited unchanged.
- Choosing the Sphere-MCP **transport** (settled by ADR-007) or the concrete
  channel↔identity binding (RFC-007 leaves it to the Harness; the governance anchor
  remains the per-agent token).
- Renaming the `AgentRuntime` port in code as part of this ADR (noted as optional
  future cleanup only).

## Acceptance criteria

- The docs define **Harness** as the governed agent-execution role, explicitly
  distinct from the inference runtime and from the Policy Engine, and state that an
  agent never executes bare.
- No production/live code path executes an agent outside a Harness; an agent reaches
  capabilities only via the Sphere MCP, policy-checked per call, and never calls a
  model, tool, or integration on its own authority.
- The domain core imports nothing Harness-specific; **Hermes is the sole Harness
  adapter**, and replacing or adding a Harness requires no policy, memory,
  capability, or token migration.
- The per-agent governed model (RFC-009) is the model the Harness runs on — it is
  projected into the Harness profile, never overridden by a Harness-local default.
- The Harness is never treated as the authorization/privacy boundary: governance
  decisions precede projection, and the Sphere MCP re-checks every call as defence
  in depth.
- The direct `AgentRuntime` (inference) path is documented as a Harness backend
  and/or a dev/test harness only — not a production agent-execution path.
