# RFC-003 — Sphere Configuration and Admin UI

## Status

Accepted.

## Summary

The KinOS web UI grows from a read-only consumer into a **governed configuration
and administration surface** for a Sphere. From the UI an administrator can:
add and remove connectors (integrations), browse and install/remove packages
from the store (RFC-002), select the inference provider and model (RFC-004),
manage members and agents, and talk to an agent with session history (RFC-005).

The UI **never decides authorization**. Every configuration action maps to an
existing governed capability and API call, is evaluated by the Policy Engine,
carries a correlation id, and is audited. This RFC revises the ADR-006 note that
"the UI is a read-only consumer": the UI may *trigger* governed write actions; it
still decides nothing (coding principle 1).

## Motivation

The MVP UI today reads already-governed state (Spheres, members, agents,
approvals). results-contract §18 requires a UI that hides complexity and lets an
administrator run a Sphere without hand-editing policies, bindings or SQLite.
The semantic write surface already exists in `docs/architecture/api-contract.md`
(Sphere/Member/Agent/Integration/Capability/Policy/Approval groups) and in
RFC-002 (package install). What is missing is an accepted document stating that
the UI is allowed to be the front-end for those governed actions, and under what
rules — so implementation does not drift into letting the UI become a decision
point.

## Proposal

### The UI is a consumer of governed write endpoints

- The UI calls the governed API; the API runs the full pipeline
  (Identity → Policy → Capability → Runtime/Integration). The UI renders the
  outcome (`allow` proceeded, `deny` refused with a safe reason, `require_approval`
  shows a pending state referencing the Approval Request).
- The UI holds no policy logic, no authorization branching that the Policy Engine
  could not reproduce, and no provider/runtime internals (results-contract §18).
- Deny by default in the UI too: a capability with no enabled binding renders as
  **unavailable**, never as a silent default (coding principle 6).

### Configuration actions, mapped to governed capabilities

| UI action | Governed capability / API | Notes |
|---|---|---|
| Add / remove a connector | `integration.enable` / `integration.disable`, `integration.update_scopes`, `integration.disconnect` (api-contract §Integration) | admin-only, high-risk, policy-checked |
| Bind / unbind a capability | `capability.bind` / `capability.disable_binding` (api-contract §Capability) | admin action, never an agent action |
| Browse the store | `store.browse` (RFC-002) | low risk |
| Install / remove a package | `package.install` / `package.uninstall` / `package.disable` (RFC-002) | runs the grant wizard; install ≠ authorization |
| Select provider / model | RFC-004 capabilities | cloud selection = consent + external-transfer rules |
| Update Sphere settings | `sphere.update_settings` (api-contract §Sphere) | admin-only |
| Create, activate or disable a rule | `policy.manage` (api-contract §Policy) | admin-only; policies remain versioned and evaluated by the Policy Engine |
| Manage members / agents | api-contract §Member, §Agent | role-gated |
| Chat with an agent | RFC-005 `chat.send` | per-member, session-scoped |

These administrative capabilities are **high-risk and admin-only** by default,
policy-checked per call, and may be approval-gated (ADR-004). Each emits minimal
audit facts under one correlation id (coding principles 7, 10).

### What the UI shows and hides

- Shows: governed state and the outcome of governed actions (allowed / denied /
  pending approval), with safe reasons.
- Hides: embeddings/vector stores, raw MCP tool ids, runtime internals, secret
  values (only secret *references* and scopes are shown — integration-model.md,
  secret-store.md). Capabilities are the only agent-facing surface (no raw tools).

### Administrator identity

The admin acting in the UI must be a resolved identity. Real authentication is
out of scope for this RFC; during development the actor is selected via the
dev-only impersonation affordance (RFC-006). The Policy Engine governs the
selected actor exactly as for any member — being "admin in the UI" grants nothing
the actor's role does not already grant.

## Domain impact

- No new domain entity: configuration is the existing Sphere settings + capability
  bindings + policies + integrations + packages. This RFC governs how the UI
  *exposes* them.
- The administrative capabilities referenced above (`integration.*`,
  `capability.bind`, `package.*`, `sphere.update_settings`, plus RFC-004/005
  capabilities) are confirmed as the UI's write surface and must exist in the
  capability catalog with admin-only, high-risk defaults.
- ADR-006 is amended: "UI = read-only consumer" → "UI = consumer that may trigger
  governed write actions and decides no authorization."

## Security and privacy impact

- **UI is not the boundary** (invariants 3, 10; coding principles 1, 2): the
  Policy Engine, not the UI, authorizes every action.
- **Deny by default** (coding principle 6): unavailable capabilities are not
  silently defaulted.
- **External transfer** (invariant 14): enabling a cloud integration or cloud
  model from the UI triggers the external-transfer/consent rules (RFC-004,
  privacy-model.md).
- **Audit** (invariant 16): all config actions are audited as security facts
  under a correlation id; the UI never logs private content.
- **Minor protection** (invariant 8): minor-restricted defaults are preserved;
  no UI path silently widens a minor's access.

## Alternatives considered

- **UI edits SQLite / domain entities directly.** Rejected: bypasses the Policy
  Engine and audit, makes the UI the boundary (invariants 3, 6, 10).
- **Keep the UI read-only; configure only via CLI.** Rejected: contradicts
  results-contract §18 (a UI that hides complexity for non-technical admins).
- **A privileged "admin mode" that skips policy checks.** Rejected: inverts
  deny-by-default and lets the UI grant rights (invariants 6, 7).

## Open questions

- Real administrator authentication and session management (login) — deferred;
  dev uses RFC-006 impersonation in the interim.
- UX for the `require_approval` outcome (optimistic vs. blocked pending state).
- Whether some low-risk settings (e.g. UI theme) should bypass the governed path
  entirely as pure client state.

## Acceptance criteria

- The UI performs no authorization the Policy Engine could not reproduce; all
  write actions go through governed API endpoints.
- Each configuration action maps to a named, admin-only, policy-checked capability
  that emits audit facts under a correlation id.
- A capability with no enabled binding renders as unavailable (no silent default).
- Enabling a cloud integration or cloud model from the UI invokes the
  external-transfer/consent path (RFC-004).
- ADR-006's "read-only consumer" note is updated to reflect the governed-write
  surface.
- The UI surfaces `allow` / `deny` / `require_approval` outcomes with safe reasons
  and never displays secrets, embeddings, raw tool ids or runtime internals.
