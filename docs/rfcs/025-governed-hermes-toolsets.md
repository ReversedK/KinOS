# RFC-025 — Governed Hermes native toolsets

## Status

Accepted

## Summary

Govern Hermes' native tools **at the toolset level**, through the projected agent
config, as a channel **distinct** from the Sphere-MCP capability surface. This
closes a real hole — KinOS today projects a `native_tools.allow` key that Hermes
does not read, so an agent's native tools fall back to Hermes' *defaults* (web,
memory, terminal, …) entirely ungoverned — and it makes Hermes' rich native surface
grantable through the same deny-by-default policy/approval model as everything else.

Three rules fall out and are non-negotiable:
- **Deny by default at the toolset level** (`agent.enabled_toolsets` = only what is
  granted; nothing by default).
- **A hard floor that is never grantable:** `agent.disabled_toolsets` always includes
  `memory`, `terminal`, `file`, `execute_code` — regardless of any grant.
- **Memory is served by the Sphere MCP, not Hermes.** The native `memory` toolset is
  always off; the agent's memory is KinOS canonical memory via the MCP `memory.*`
  capabilities (invariant 2 — the runtime never owns memory).

## Motivation

- **A governance hole, verified.** The real Hermes keys are
  `agent.enabled_toolsets` / `agent.disabled_toolsets` (`hermes_cli/tools_config.py`);
  `native_tools.allow` is not read by Hermes. Our projection's "deny-by-default
  native-tool allow-list" therefore does nothing: Hermes uses its default toolsets,
  so agents get ungoverned web, terminal, file *and a native memory store* — the last
  a shadow of canonical memory (breaks invariant 2).
- **Hermes' power should be governed, not rebuilt.** Weather, web search, scheduling
  (cron), browsing are all Hermes-native. Store packages that reimplement them would
  duplicate Hermes (the channel-wizard mistake). The right primitive is a *governed
  grant* of a Hermes toolset.
- **Two distinct channels deserve distinct governance surfaces.** The Sphere MCP is
  KinOS's governed tool surface; Hermes toolsets are the runtime's native power.
  Keeping them visibly separate (in projection and UI) keeps the model honest.

## Verified facts (Hermes)

- Toolsets are enabled/disabled by name via `agent.enabled_toolsets` /
  `agent.disabled_toolsets`; the latter is a global final subtraction that overrides
  per-platform config. Toolset names include `web`, `x`, `browser`, `terminal`,
  `file`, `media`, `memory`, `cron`, `agent` (delegate).
- External memory providers "operate alongside built-in memory, never replacing it"
  — there is **no** supported way to swap Hermes' memory backend, so the only way to
  prevent a shadow store is to **disable** the `memory` toolset.
- `delegate_task` subagents inherit the parent's credentials and run under the same
  profile/config; `disabled_toolsets` (global) binds them; nested delegation is off
  by default (`max_spawn_depth: 1`, `orchestrator_enabled`).

## Proposal

### 1. Projection: real keys, deny-by-default (correctness fix)

Replace the fictional `native_tools: { allow: [...] }` with the real
`agent.enabled_toolsets` / `agent.disabled_toolsets`. The projection computes:

- `enabled_toolsets` = exactly the native toolsets the policy authorizes for the
  agent (empty by default → no native tools);
- `disabled_toolsets` = the hard floor `["memory", "terminal", "file",
  "execute_code"]` always, plus anything else not granted — belt-and-suspenders, and
  it binds subagents.

`RuntimeConfigProjection.nativeToolsAllow` is replaced by
`enabledToolsets` / `disabledToolsets`; `HermesConfig` emits an `agent:` block.

### 2. Native toolsets as a distinct grantable channel

Introduce capability names namespaced `native.*` — `native.web`, `native.cron`,
`native.media`, `native.browser` — one per grantable toolset. They flow through the
**same** governance (catalog profile floor, deny-by-default policy, approval floor,
the RFC-023 wizard) as any capability, but project to a **distinct** channel: a
`native.<toolset>` grant maps to `enabled_toolsets`, never to the Sphere-MCP
`tools.include`. The two lists stay visibly separate in the agent's config and UI.
Non-grantable toolsets (`terminal`, `file`, `execute_code`, `memory`) get **no**
capability — they are floor-denied, not merely ungranted.

| Capability | Toolset(s) | Age | Floor |
|---|---|---|---|
| `native.web` | `web`, `x` | adult (minor deny) | none — read-only |
| `native.cron` | `cron` | adult | none (triggered actions still MCP-policy-checked) |
| `native.media` | `media` | adult | none |
| `native.browser` | `browser` | adult | **approval** — it acts on the web |

### 3. Memory via the Sphere MCP (decision #3)

`memory` is always in `disabled_toolsets`. The agent's memory is the Sphere-MCP
`memory.*` capabilities (already exposed). This is the achievable form of "use the
MCP for memory" given Hermes cannot swap its memory backend: native off, MCP on — no
shadow store, agent keeps governed memory.

### 4. Store toolset-governance packages

Curated packages that install a native toolset grant with deny-by-default policies:
"Web (Hermes)" → `native.web`, "Automation (Hermes cron)" → `native.cron`, "Media
(Hermes)" → `native.media`, "Browser (Hermes)" → `native.browser` (approval-floored).
Installing proposes the grant; enabling activates the policy — same lifecycle as
today's packages. No package exists for the floor-denied toolsets.

### 5. Subagents inherit, bounded (decision #4)

The projection sets conservative delegation (`max_spawn_depth: 1`, flat leaves) so a
subagent cannot itself delegate. Because subagents run under the parent's profile and
credentials, they inherit the parent's Sphere-MCP token (same governed principal —
their MCP actions are policy-checked identically) and are bound by the global
`disabled_toolsets` (they cannot exceed the parent's toolset grant or reach a
floor-denied toolset). `native.delegate` is **not** offered in this RFC — spawning
subagents stays off until we validate token propagation end-to-end against Hermes.

## Domain impact

New `native.*` capabilities in the catalog (a small, namespaced family). The runtime
projection changes shape (`enabledToolsets`/`disabledToolsets` replace
`nativeToolsAllow`); `HermesConfig` gains the `agent:` block and drops `native_tools`.
No memory, policy, or approval semantics change — `native.*` reuse the existing
pipeline. New store packages, no new package model.

## Security and privacy impact

- **Closes a governance hole:** native tools become genuinely deny-by-default;
  today they run at Hermes' (permissive) defaults.
- **No shadow memory:** the native `memory` toolset is force-disabled; canonical
  memory via the MCP is the only memory (invariant 2).
- **Hard floor:** `terminal`/`file`/`execute_code` are never grantable — no policy or
  package can enable them; a family agent cannot get a shell.
- **Deny by default + minor safety:** `native.*` carry the catalog profile floor
  (adult-only), so minors get no native tools; `native.browser` is approval-floored.
- **Subagents cannot escape:** bound by the global toolset floor and the inherited
  Sphere-MCP token; delegation is flat and `native.delegate` is withheld.

## Alternatives considered

- **Per-tool governance** (`allowed_tools`). Rejected: Hermes groups tools into
  toolsets and governs at that grain; per-tool is finer than needed and noisier.
- **Rebuild utilities as packages** (weather, web search). Rejected: duplicates
  Hermes-native tools — the mistake this RFC exists to avoid.
- **A KinOS memory-provider plugin** so Hermes routes memory to KinOS. Rejected:
  Hermes keeps built-in memory active *alongside* any provider, so the shadow store
  remains; large custom build for no invariant win.
- **Unify native grants with MCP capabilities.** Rejected per decision #2: the two
  channels stay distinct in projection and UI, even though they share the policy
  engine.

## Open questions

- `native.delegate` (subagents) once token propagation to children is verified live
  against Hermes.
- `integrations` toolset (Home Assistant, …) — overlaps KinOS's own integration
  model; deferred pending a decision on which owns device/service integrations.
- Whether `enabled_toolsets` fully replaces Hermes' default set or merely adds to it
  (must be confirmed at implementation so deny-by-default is real, not additive).

## Acceptance criteria

- The projection emits `agent.enabled_toolsets` / `agent.disabled_toolsets`; the dead
  `native_tools.allow` is gone.
- `disabled_toolsets` always contains `memory`, `terminal`, `file`, `execute_code`;
  no grant or package can remove them.
- `native.web` / `native.cron` / `native.media` / `native.browser` exist
  (adult-only; browser approval-floored), each granted only via its store package,
  and project only into `enabled_toolsets` — never the Sphere-MCP surface.
- An agent with no native grant projects an empty `enabled_toolsets`.
- Verified against the running stack: a granted toolset appears in the projected
  config's `enabled_toolsets`; the floor is always present; minors are denied.
