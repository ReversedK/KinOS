# RFC-027 — Enforce per-agent capability scope

## Status

Accepted

## Summary

Make an agent's declared capability scope (`Agent.enabledCapabilities`) actually
constrain what the agent can do. Today it is stored, returned and displayed but
enforced **nowhere** — an agent's effective surface is derived purely from its owner's
role, the Sphere's policies and the bindings, ignoring the scope it was deployed with.
This RFC makes the agent's effective surface = **policy-authorized ∩ declared scope**:
a narrowing, never an expansion, deny-by-default.

## Motivation

"Deploy an agent with a narrow capability scope" is a headline of the product and of
the deploy/onboarding UX (RFC-008/023). It does nothing today. Found via the live
runtime run: an agent deployed with scope `[memory.search]` was offered **all four**
`memory.*` tools by the Sphere MCP, because the projection and the MCP surface call
`resolveAuthorizedCapabilities(subject, {catalog, policies, bindings})` with no scope.
Two agents owned by the same parent get identical surfaces regardless of what you
declared. That is a least-privilege hole in the core governance promise: per-agent
scope is the mechanism for giving one agent memory and another the calendar, and it is
currently cosmetic.

## Proposal

The agent scope is a per-agent **restriction on top of policy**. A capability is
available to an agent only when the Policy Engine authorizes it for the subject AND it
is bound AND it is in the agent's `enabledCapabilities`. Scope can only reduce the
policy-authorized set; it never grants anything policy denies.

Enforce at both the surface and the execution boundary (defence in depth):

1. **Surface** — `resolveAuthorizedCapabilities` gains an optional
   `agentScope?: string[]`. When present, a capability outside the scope is not
   offered. This one function feeds both:
   - the runtime **projection** (`projectAgentRuntimeConfig` gains `agentScope`, passed
     the agent's `enabledCapabilities`) — Hermes registers only in-scope tools
     (MCP tools *and* `native.*` toolsets alike); and
   - the Sphere-MCP **tools/list** — the agent is offered only in-scope tools.

2. **Execution** — `handleSphereMcpCall` refuses a `tools/call` for a capability
   outside the agent's scope, before any policy check (`ResolvedAgentIdentity` gains
   `scope`). An agent that names an out-of-scope capability directly is denied and
   audited, not merely un-offered.

**Empty scope = no capabilities.** An agent deployed with an empty scope is inert
(deny-by-default). This is a behaviour change — today an empty scope still yields the
full policy-authorized set — and it is the correct, safe default: you declare what an
agent may do.

## Domain impact

`resolveAuthorizedCapabilities` and `projectAgentRuntimeConfig` gain an optional
`agentScope`; `ResolvedAgentIdentity` gains an optional `scope`; `handleSphereMcpCall`
enforces it. `Agent.enabledCapabilities` is unchanged — it stops being advisory. No
new capability, policy, or event. Callers that pass no scope keep today's behaviour
(the generic resolver, the RunCapability bench, provisioning), so only the agent (MCP
and projection) path is scoped — which is exactly where per-agent least privilege
belongs.

## Security and privacy impact

- **Restores least privilege.** An agent can use only the intersection of what its
  role/policy allows and what it was scoped for; the scope you declare is the ceiling.
- **Deny-by-default and defence in depth.** Out-of-scope is denied both by omission
  (not offered) and at execution (refused before policy). Empty scope → nothing.
- **No new authority.** Scope can only *narrow*; it can never let an agent do something
  policy forbids. Anchoring stays on the agent credential (unchanged).
- **Existing agents are corrected, not migrated.** Their stored scope now binds; an
  agent already deployed for `[memory.search]` is constrained to it. No data change.

## Alternatives considered

- **Enforce only at the surface (offering).** Rejected — an agent could still call an
  out-of-scope, policy-allowed capability by name; execution must refuse too.
- **Treat empty scope as "all policy-allowed" (today's behaviour).** Rejected — it is
  the hole; declaring an empty scope must mean an inert agent, not a fully-capable one.
- **A separate per-agent policy instead of a scope list.** Rejected — `enabledCapabilities`
  already exists and is the UX surface; making it real is simpler than a parallel
  mechanism, and policy stays the Sphere-level rule.

## Open questions

- Whether the deploy/wizard UI should warn when a scoped capability is not
  policy-authorized for the owner (in scope but policy-denied → silently unavailable).
  A UX refinement, not a governance gap.

## Acceptance criteria

- An agent scoped `[memory.search]` is offered and can call only `memory.search`, even
  where its owner's policy authorizes more `memory.*`; the others are denied.
- The projected Hermes config and the MCP `tools/list` both reflect the intersection.
- A direct `tools/call` for an out-of-scope capability is denied (and audited), not
  executed — even though policy would allow it.
- An empty-scope agent is offered nothing and can call nothing.
- Scope never expands the set: a capability in scope but policy-denied stays denied.
- Verified live: re-run the projection/MCP flow and confirm the scoped agent sees only
  its scope.
