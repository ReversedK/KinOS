# RFC-040 — Surface a pending approval to the agent as a request, not a failure

## Status

Accepted

## Summary

When an agent calls a capability that requires approval, the Sphere MCP returned the
call as an `isError: true` tool result carrying the bare policy reason — so the agent
believed the action *failed* and gave up ("I can't do it myself") instead of telling
the user an approval was requested. A pending approval is a legitimate, deferred
outcome, not an error. Return it as `isError: false` with an explicit, actionable
message ("not performed yet; an approval request was submitted; ask a human to
approve it") and the approval id, so the agent relays the right thing.

## Motivation

Observed from an agent (Hermes TUI): asked to book a calendar event, it correctly
called `calendar.create_event` (after RFC-039), the Policy Engine routed it to
approval, the request was persisted (visible in the Approvals inbox) — but the tool
result was `isError: true` with reason "Adults may propose events on the connected
calendar, subject to approval." The agent read that as a rejection and offered to try
another calendar or name, never telling the user "your approval is needed."

`require_approval` is the core's human-in-the-loop mechanism (ADR-004). The MCP was
conflating it with a denial. The two are different outcomes and must read differently
to the agent.

## Proposal

In the Sphere MCP `tools/call` result mapping:

- `ok` → success (unchanged).
- **`pending_approval`** → `isError: false`, content that states plainly the action
  was **not performed yet**, that a request was submitted for a human approver (with
  the approval id and approver role), that it will run once approved in the Approvals
  inbox, and that the agent should tell the user and **not retry**. `_meta.status`
  is `pending_approval` with the `approvalId`. The request is still persisted for the
  approver (unchanged).
- `denied` / `unauthenticated` / `failed` → `isError: true` (unchanged) — these are
  real failures.

## Domain impact

None. One change to the app-layer MCP result mapping. No domain, capability, policy,
approval-state, event, or entity change. The approval is created and persisted
exactly as before; only how the outcome is *described to the caller* changes.

## Security and privacy impact

- **No governance change.** The action still does not execute; a human approver must
  still grant it (quorum, no-self-approval, minor-safety all unchanged). Nothing is
  authorized that wasn't before.
- **No content leak.** The message names the capability outcome and the approval id
  (already a governed reference), never private payload (§18). The approval id lets a
  human find the request in the inbox.
- **Fewer misleading dead-ends.** The agent stops presenting a governed pause as a
  failure, reducing wasted retries and user confusion — a robustness win, not a new
  surface.

## Alternatives considered

- **Keep `isError: true` but improve the message.** Rejected — `isError: true` tells
  the model the call failed, so it routes around it; a pending approval is a deferred
  success, and marking it an error is the root of the misread.
- **Return `ok` with the (not-yet-existing) output.** Rejected — the action has not
  run; claiming a result would make the agent report success falsely. The message
  must state it is pending.
- **Auto-notify the approver from the MCP.** Out of scope — the approval already
  lands in the governed inbox; notification is a separate concern.

## Acceptance criteria

- A `require_approval` capability called via `tools/call` returns `isError: false`
  with `_meta.status = "pending_approval"`, an id, and a message that says it was not
  performed yet and needs a human's approval.
- The approval is still persisted and appears in the Approvals inbox for the eligible
  approver.
- `denied` / `unauthenticated` / `failed` still return `isError: true`.
