# RFC-045 — Project a governed agent memory directive (so the agent actually uses memory)

## Status

Accepted

## Summary

An agent now has built-in memory tools (RFC-043) and sees them over the Sphere MCP,
but it does not *use* them: asked a question, it doesn't call `memory.search`; told
to remember, it may not call `memory.capture`. Having a tool available is not the
same as being instructed to use it. KinOS projects the agent's model, tools and MCP
(RFC-007) but **no system prompt / instructions**, so the runtime has no directive to
consult memory. Project a short, governed **memory directive** into the agent's
Hermes profile — via Hermes' `agent.platform_hints.<gateway>.append` (read at agent
init, appended to the system prompt) — whenever memory is in the agent's projected
surface, so the agent recalls before answering and remembers when asked.

## Motivation

Observed: "the agent doesn't search its memory when I ask it a question, even though
it sees the MCP memory tool." Verified in code: the projection (`hermes-config.ts`)
writes model, `mcp_servers`, toolsets and `autonomous_mcp_install` — never a system
prompt; the `Agent` entity has no instructions field. Hermes builds the system prompt
from its own defaults plus, per platform, an optional `platform_hints` append/replace
read from `config.yaml` (`agent/agent_init.py` → `_platform_hint_overrides`;
`agent/system_prompt.py`). KinOS leaves that empty, so the model is never told it has
durable memory or when to use it — and small local models especially won't call a
tool unprompted.

## Proposal

When an agent's projected surface includes memory (`memory.search` and/or
`memory.capture` in `gateway.allowedTools`), the projection writes:

```yaml
agent:
  disabled_toolsets: [...]
  platform_hints:
    api_server:            # the gateway platform KinOS runs Hermes as
      append: |
        You have a durable, private memory that persists across sessions, reached
        through your tools. Before answering a question that may depend on earlier
        information, call `memory.search` to recall relevant facts. When the user
        tells you to remember something, call `memory.capture` to save it. Never say
        you cannot remember across sessions — use these tools.
```

Details:

- **Only when memory is projected.** If an admin removes memory from the agent's
  scope, no directive is written (the projection reflects the governed surface). The
  gateway platform key is the same `api_server` the toolset governance uses (RFC-025).
- **Append, not replace.** It adds to Hermes' built-in platform hint; it does not
  override the runtime's own instructions. Hermes ignores a malformed hint
  defensively, so it can never break prompt assembly.
- **A prompt hint, not authorization.** The directive only nudges *usage*; it grants
  nothing. Every memory call is still policy- and scope-checked at the Sphere MCP
  (invariant: a prompt is never the authorization boundary). Removing the directive
  changes behaviour, not permissions.
- Re-projecting an existing agent adds the directive to its profile; it takes effect
  on the agent's next session.

## Domain impact

App/adapter only. `hermes-config.ts` (the projection→Hermes serializer) gains an
optional `agent.platform_hints` and writes the memory directive when memory is in the
projected `allowedTools`. No domain, capability, policy, event, or entity change. A
future per-agent `instructions`/persona field (admin-editable) can layer on the same
mechanism; out of scope here.

## Security and privacy impact

- **No new authority.** The directive is instruction text in the system prompt; it
  cannot make the model do anything the Policy Engine and RFC-027 scope don't already
  allow. Memory stays private-by-default and policy-scoped on read (ADR-002/RFC-043).
- **No content in the projection.** The directive is generic guidance — it contains
  no memory content, no member data; audit minimality is untouched.
- **Governed and reversible.** It is projected by `runtime.config.project` (admin,
  approval-floored) and only when memory is granted; remove memory from scope and the
  directive disappears on the next projection.
- **Least surprise for minors.** Nothing changes for a child-owned agent that has no
  memory grant (capture is floored to adults/teens) — no directive is written.

## Alternatives considered

- **Rely on tool descriptions alone.** Already improved (RFC-043: "Recall facts from
  your durable memory…"), but descriptions don't make a model call a tool proactively;
  a system-prompt directive does. Keep both.
- **A per-agent free-text instructions field now.** Deferred — the immediate need is
  that memory is used at all; a governed default directive fixes that without a new
  entity field. The persona field is a clean follow-up on the same `platform_hints`
  channel.
- **Bake the directive into KinOS's own MCP server metadata.** MCP has no
  standard "always call me" signal the runtime must honour; the runtime's system
  prompt is the reliable lever, and Hermes exposes it via `platform_hints`.
- **Use `agent.system_prompt` (the /personality key).** Rejected — that key is a
  runtime/interactive setting and is not reliably read from a projected profile at
  gateway start; `platform_hints` IS read at agent init (verified), so it is the
  correct projection target.

## Acceptance criteria

- Projecting an agent whose surface includes memory writes
  `agent.platform_hints.api_server.append` with the memory directive; an agent without
  memory in scope gets no such hint.
- The projected `config.yaml` parses and Hermes loads the hint at agent init
  (verified against the live container).
- After re-projecting, a new session's agent, asked a question that depends on a
  previously remembered fact, calls `memory.search` and answers from it; told to
  remember, calls `memory.capture`.
- The directive grants nothing: an out-of-scope or policy-denied memory call is still
  refused at the Sphere MCP.
