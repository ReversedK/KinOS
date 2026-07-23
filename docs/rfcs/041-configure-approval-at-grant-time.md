# RFC-041 — Configure approval per capability at grant time (not per action)

## Status

Accepted

## Summary

When enabling a package, an admin can already choose *who* may use it; they cannot
choose *whether each capability requires approval*. So a package whose preset is
`require_approval` (e.g. `calendar.create_event`, `memory.share`, `message.send`)
forces a human decision on **every** action — an agent can't book a calendar event
without a parent approving each one. Surface the per-capability approval choice in
the install wizard: for each capability the package grants, the admin picks "allow
without approval" or "require approval each time" — bounded by the catalog's approval
**floor** (payment, browser, export, runtime), which can never be lowered. The
backend already supports this (RFC-014 custom grant clauses carry an `effect`); this
exposes it and wires the wizard.

## Motivation

Observed live: an agent asked to book a calendar event correctly requested it, the
Policy Engine routed it to approval (`calendar.create_event` preset is
`require_approval`), and a parent had to approve. That is right *by default* but must
be **configurable up front** — a family that trusts its agent to manage the shared
calendar should be able to allow it outright, while still keeping approval for
payments. The default stays safe (deny/approve by default); the admin opts into less
friction, per capability, knowingly.

## Proposal

1. **`/store` exposes per-capability grant metadata.** Each package's capabilities
   are returned as `{ name, defaultEffect, approvalFloor }` where `defaultEffect` is
   the manifest preset's effect for that capability (`allow` | `require_approval`)
   and `approvalFloor` is the catalog floor (true → approval can never be removed).

2. **The install wizard's Access step gains an approval choice** per capability that
   is *approval-relevant* (its default is `require_approval`, or it has a floor). For
   each: "Require approval each time" or "Allow without approval". A floored
   capability is locked to "always requires approval" with an explanation.
   Read-only/allow-by-default capabilities need no toggle.

3. **The wizard builds grant clauses** (RFC-014) from the choices — an `allow` clause
   for the capabilities the admin allows outright and a `require_approval` clause
   (with the eligible approver roles) for the rest — scoped to the chosen audience.
   Custom clauses replace the package's default preset (RFC-014). Enable applies them.

The floor is the backstop: even if a clause says `allow` for a floored capability,
the engine raises it to `require_approval` (with default approver roles) — the UI
reflects that so the admin is never misled.

## Domain impact

None. `/store` returns extra descriptive fields; the wizard composes existing RFC-014
grant clauses. No new capability, policy shape, event, approval state, or entity. The
Policy Engine, the approval floor, and every governed check are unchanged.

## Security and privacy impact

- **Safe by default; opt-in to less friction.** The recommended default remains the
  package preset (approval where the domain set it). Removing approval is an explicit
  admin choice, recorded as a normal policy, and only where no floor forbids it.
- **The floor is inviolable.** Critical/irreversible capabilities (payment, browser,
  export, runtime config/restore) keep their approval floor no matter what the admin
  picks — the engine enforces it and the UI shows it as non-negotiable.
- **Deny-by-default preserved.** A capability an admin doesn't grant is still denied;
  minors still can't be granted a write off their profile floor (invariant 8).
- **Auditable.** The chosen effect is a governed policy with a version and id, so the
  configuration is inspectable and revocable like any other.

## Alternatives considered

- **A global "trust this agent" switch.** Rejected — too coarse; approval is
  per-capability by design (you may trust calendar but not payments). Per-capability
  choice matches the governance model.
- **Only offer allow/approval on the whole package.** Rejected — a package can
  provide several capabilities of different risk (read vs. create vs. share); the
  choice belongs at the capability level.
- **Let the agent's scope encode approval.** Rejected — scope (RFC-027) is *which*
  capabilities, not *how* they're gated; gating is policy (RFC-014), which is where
  this belongs.

## Acceptance criteria

- `/store` returns, per package capability, `defaultEffect` and `approvalFloor`.
- The install wizard lets an admin set, per approval-relevant capability, "allow" or
  "require approval"; a floored capability is locked to approval with a reason.
- Enabling with "allow" on `calendar.create_event` lets an agent create events with
  no per-action approval; enabling with "require approval" keeps the human step.
- `payment.execute` stays approval-gated regardless of the choice (floor).
- Verified live: enable a calendar package "allow", and an agent creates an event
  without a pending approval; switch to "require approval" and it routes to the inbox.
