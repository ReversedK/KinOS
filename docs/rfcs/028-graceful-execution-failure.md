# RFC-028 — Graceful execution failure: never strand a granted approval

## Status

Accepted

## Summary

A governed action that **fails while executing** (the capability handler throws — its
target no longer exists, an external call errors) must be a *terminal, recorded
outcome*, not an unhandled throw. Today `executeCapability` runs the handler with no
guard, so a handler error propagates as an exception. On the approval-grant path this
has a sharp edge: the approver's grant decision is made and emitted, but the throw
bypasses the persistence of the resolved approval — so the approval is left **`pending`
forever**, re-appearing in the inbox and re-grantable even though the action can never
succeed. This RFC makes execution failure a first-class outcome (`capability.failed`),
surfaced cleanly and, on the grant path, persisted so the approval leaves the inbox.

## Motivation

Found while diagnosing a live report: "grant memory.share → *Memory item x not found*".
That specific case was stale test data (a share of a non-existent item), and the system
was *correct* to refuse it — but tracing it exposed a real, capability-agnostic gap.

`resolveApproval` (`flow/sensitive-action.ts`) records the approver's decision, emits
`approval.granted`, then calls `executeCapability`. `executeCapability`
(`capability/resolver.ts`) calls `deps.executor.execute(...)` with **no try/catch**. If
the handler throws, the exception unwinds out of `resolveApproval` to the API layer,
which catches it and returns `422`. But the granted `ApprovalRequest` is only persisted
*after* `resolveApproval` returns (`router.ts`, `if (result.approval !== undefined) save(...)`);
because it threw, `result` is undefined and **the save never runs**. The approval stays
`pending`.

Real-world trigger, not a test artefact: an agent requests `memory.share` of note A; a
parent takes a day to approve; note A is deleted in the meantime; the parent clicks
grant → a cryptic error **and** an approval that will not clear from the inbox except by
denial. The human already decided. A deterministically-failing action should not loop.

## Proposal

Treat "the handler threw" as an outcome, not a crash.

1. **Core — `executeCapability` catches handler failure.** Wrap the single
   `executor.execute(...)` call in try/catch. On throw, record a `capability.failed`
   security fact (the authorization chain already recorded `capability.requested` →
   `allowed`; this closes it) and return a new outcome `"failed"` carrying the error
   message as its reason. No private payload content is recorded — only the handler's
   message and the standard chain fields.

2. **Core — a first-class `execution_failed` status.** `CapabilityOutcome` gains
   `"failed"`; `SensitiveActionStatus` gains `"execution_failed"`. Both
   `beginSensitiveAction` and `resolveApproval` map `outcome: "failed"` to
   `status: "execution_failed"`.
   - `resolveApproval` returns the **granted** `ApprovalRequest` alongside the failure,
     so the caller persists it. The grant is a real, recorded decision; the action
     simply did not complete.

3. **API — persist the resolved approval, then surface the failure.** On the grant path
   the router already persists `result.approval` when present; because `resolveApproval`
   now *returns* (instead of throwing), the granted approval is saved — it leaves the
   `pending` inbox — and the router returns `422 execution_failed` with the user-safe
   reason. The pre-existing `try/catch` stays as a genuine safety net (e.g. a wrongful
   self-approval throws in `recordApprovalDecision`, *before* execution — that must
   **not** persist and must leave the approval pending for a valid approver).

4. **MCP — clean tool error, no thrown RPC.** `handleSphereMcpCall` maps
   `execution_failed` to a `failed` result status; the Sphere-MCP server already renders
   any non-`ok` status as an `isError` tool result, so a failing `tools/call` returns a
   clean error to the agent instead of throwing out of the RPC handler.

**The invariant this restores:** an approval, once an approver acts on it, reaches a
terminal state. Grant + execution-success → executed. Grant + execution-failure →
resolved-granted, action-failed, *out of the pending inbox*. Only an un-acted or
wrongfully-acted approval stays `pending`.

## Domain impact

`CapabilityOutcome` gains `"failed"`; `SensitiveActionStatus` gains `"execution_failed"`;
`SphereMcpStatus` gains `"failed"`; `KinEventType` gains `"capability.failed"`. No new
capability, policy, binding, or approval **state** — a granted-then-failed approval is
still `granted` (the decision that was made); the failure is an audit fact and an API
status, not a new lifecycle state. Callers that only handle the old outcomes keep
compiling except at the explicit switch points, which are updated.

## Security and privacy impact

- **Deny/terminal by default.** A failed action is a terminal outcome, never a silent
  strand nor a retry loop. The human's decision is honoured once.
- **Audit minimality preserved.** `capability.failed` carries the handler's message and
  the standard chain fields (correlation id, actor/agent, capability) — a security fact,
  not conversation content (invariant: audit minimally, §18). The message is the
  handler's own (e.g. a not-found on an *id*), never the payload.
- **No new authority.** Nothing here grants a capability; it only changes how a failure
  after an already-granted authorization is recorded and surfaced.
- **Correlation chain stays intact.** requested → allowed → (approval.requested →
  approval.granted) → **capability.failed**, all under one correlation id.

## Alternatives considered

- **Revert the approval to `pending` on execution failure (retry).** Rejected as the
  default: a deterministic failure (target gone) would loop forever, exactly the current
  bug. Transient-failure retry is a real but separate concern — a future idempotent
  re-run raises a *new* request; it does not re-open a resolved decision.
- **Validate the target at request time (e.g. memory.share checks the item exists).**
  Rejected as *the* fix — it is capability-specific and cannot cover failures unknowable
  at request time (external calls, races). Worth doing as defence in depth later, but the
  general fix is handling execution failure wherever it arises.
- **Add a distinct `execution_failed` approval state.** Rejected — the approver's
  decision was "grant"; the state that was reached is `granted`. The execution outcome is
  orthogonal and belongs in the audit trail, not as a second approval state to reason
  about everywhere.
- **Leave the API catch as-is (throw → 422).** Rejected — it does not fix the strand
  (the save is skipped) and reports every handler error identically with no audit fact.

## Acceptance criteria

- Granting an approval whose handler throws returns a clean `422 execution_failed` with
  the handler's reason, **and** the approval is persisted resolved (`granted`) — it no
  longer appears in `listPending` / the inbox.
- A wrongful self-approval (throws before execution) still returns an error and leaves
  the approval `pending` (a valid approver can still act).
- `executeCapability` returns `outcome: "failed"` (does not throw) when the handler
  throws, and records exactly one `capability.failed` event in the correlation chain.
- A Sphere-MCP `tools/call` whose handler throws returns an `isError` tool result, not a
  thrown RPC.
- Verified live: reproduce a grant whose action fails; confirm the `422`, the
  `capability.failed` audit fact, and that the approval is gone from the pending inbox.
