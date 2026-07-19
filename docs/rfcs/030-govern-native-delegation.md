# RFC-030 — Govern the Harness's native delegation (subagents)

## Status

Accepted

## Summary

Lift the Harness's native **delegation** toolset off the hard floor and make it a
governed, grantable capability `native.delegate`, offered as a store package. An
agent granted it may spawn focused subagents (RFC-025's "govern, don't rebuild"
applied to the last useful floored toolset). Delegation is safe to grant because a
subagent can never exceed the parent's authority: the Harness bounds a child's
toolsets to the parent's, and the child inherits the parent's governed Sphere MCP,
so every capability a subagent invokes is still policy-checked at the gateway.

## Motivation

Delegation is how an agent decomposes a task — "research these three things in
parallel," "draft each section" — and it is one of the Harness's headline native
abilities. RFC-025 governed web/cron/media/browser but kept `delegation` on the
hard floor pending a check that subagents cannot escalate. That check is now done
(against the live Harness), and the floor placement is over-conservative: it blocks
a genuinely useful, governable ability.

## Verification against the live Harness (the standing rule)

Read from the installed Harness (`/opt/hermes/tools/delegate_tool.py`), the child
agent builder `_run_single_child` / `_build_child_agent`:

- **Child toolsets ⊆ parent toolsets.** With explicit toolsets requested:
  `child_toolsets = [t for t in toolsets if t in expanded_parent]` — a pure
  intersection with the parent's enabled toolsets. With none requested, the child
  inherits `parent_enabled`. Either way a subagent **cannot gain a toolset the
  parent lacks.** KinOS clamps the parent via the exclusive
  `platform_toolsets.<gateway>` grant plus the `agent.disabled_toolsets` master
  subtraction (RFC-025), so the child inherits that clamp. The hard-floor toolsets
  (terminal, file, code_execution, computer_use, native memory) are never in the
  parent, hence never in a child.
- **Child inherits the parent's Sphere MCP.** `delegation.inherit_mcp_toolsets`
  (default true) + `_preserve_parent_mcp_toolsets` keep the parent's MCP toolset on
  the child, carrying the same per-agent token. So a subagent reaches capabilities
  only through the same governed gateway, where each call is policy-checked and
  RFC-027 scope-checked, as the same agent identity.
- **The Harness strips dangerous leaf tools from children regardless.**
  `DELEGATE_BLOCKED_TOOLS` = {delegate_task, clarify, memory, send_message,
  execute_code, cronjob} are always removed from a child; depth is flat by default
  (`MAX_DEPTH = 1`), so grandchildren are rejected unless a config knob is raised.

The subagent is the agent delegating to itself with a narrower focus. It never
holds authority the parent was not granted, and every effect still flows through
the governed pipeline. Governing delegation is therefore a grant, not a hole.

## Proposal

1. **Capability.** Add `native.delegate` to the catalog: risk medium, adults only
   (no native ability is offered to minors — RFC-025), no approval floor. Like
   `native.cron`, the grant is safe because the *actions* a subagent takes are
   individually policy-checked; spawning itself is not the dangerous edge.
2. **Toolset mapping.** Remove `delegation` from `HERMES_TOOLSET_FLOOR`; map the
   grant token `delegate → ["delegation"]` in `GRANT_TO_HERMES_TOOLSETS`. It stays
   in `ALL_HERMES_CONFIGURABLE_TOOLSETS`, so when *not* granted it is disabled by
   the master subtraction (deny-by-default), exactly as before.
3. **Store package.** `hermes-delegation` (skill, adult) — provides
   `native.delegate`; default grant: adults may delegate (`allow`).

No change to the projection plumbing: `native.delegate` already flows through
`isNativeToolsetCapability`/`toolsetOf` like every other `native.*` grant.

## Domain impact

One catalog capability, one grant-map entry, one floor removal, one store manifest.
No new event, policy shape, or approval state. The projection, MCP surface and
scope enforcement (RFC-007/025/027) carry it unchanged.

## Security and privacy impact

- **No escalation.** A subagent's toolsets are a subset of the parent's governed
  set; its capability calls go through the parent's Sphere MCP under the parent's
  token and are policy- and scope-checked per call. It cannot reach a floored
  toolset (they are absent from the parent) nor a capability outside the agent's
  RFC-027 scope.
- **Deny-by-default preserved.** Ungranted, `delegation` stays in
  `disabled_toolsets`. The floor still hard-blocks terminal/file/code/computer/
  memory; only `delegation` moves from floor to grantable.
- **Adults only.** Minors are never offered a native toolset; the package grant is
  adult-scoped (invariant 8), and the capability floor denies minors regardless.
- **Blast radius is cost, not authority.** Subagents consume model tokens and act
  in parallel. That is a resource concern (the Harness bounds depth/concurrency via
  config), not an authorization one — no subagent can do anything the parent agent
  could not already do through the governed surface.

## Alternatives considered

- **Keep delegation on the floor.** Rejected — the escalation concern that
  justified the floor does not hold (child ⊆ parent, MCP-mediated, verified live);
  the floor now just denies a useful, governable ability.
- **Require approval per delegation.** Rejected as the default — the governed edge
  is each *action* a subagent takes, and those are already approval-gated by their
  own capabilities. Gating the spawn adds friction without adding safety. An admin
  can still layer a `require_approval` policy on `native.delegate` if they want it.
- **Pin `subagent_auto_approve: false` / `max_spawn_depth: 1` in the projection.**
  Considered as belt-and-suspenders. Rejected as unnecessary for *safety*: the
  floored toolsets a child could dangerously auto-approve (terminal/execute_code)
  are absent from any KinOS-governed parent, so the auto-approve knob is moot; and
  depth only affects cost, not authority. Left to the Harness defaults; revisit if
  a future KinOS grants a toolset that acts outside the Sphere MCP.

## Acceptance criteria

- `native.delegate` is in the catalog (medium, adult-only, no approval floor); an
  ungranted agent's projected config keeps `delegation` in `disabled_toolsets`.
- Installing + enabling **hermes-delegation** yields a projected config with
  `delegation` in `platform_toolsets.<gateway>` and absent from
  `disabled_toolsets`; a child is denied by the floor for everything the parent
  lacks.
- The hard floor still excludes terminal/file/code_execution/computer_use/memory —
  granting delegation cannot reintroduce them (verified: they remain in
  `disabled_toolsets` and are absent from the parent, so absent from any child).
- Verified live: project a delegation-granted agent against the running Harness and
  confirm the toolset governance (`delegation` granted, floor intact).
