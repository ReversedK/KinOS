# RFC-009 — Governed Per-Agent Default Model

## Status

Accepted

## Summary

An agent's **default model** becomes a first-class **governed setting**: it is
selected only through the Policy Engine, may be changed only by the Sphere's
**administrators** — which by construction includes the **founder/owner** — and is
honoured by the runtime resolution path so the agent actually runs on the chosen
model. This completes RFC-004's already-accepted decision that
`agent.modelPreference` is "a governed selection within the Sphere-allowed set (no
longer a free advisory tag)", which was accepted but never fully implemented. Local
model changes are immediate (low/medium risk); cloud selection stays approval-gated
and denied for minors per RFC-004. Swapping the model stays "boring": no memory,
policy, identity or session migration (coding principle 9).

## Motivation

RFC-004 (Accepted) made provider/model a governed, per-Sphere choice with an
optional per-agent override, and listed a `model.set` capability. In the current
implementation that decision is only partly realised:

- `agent.modelPreference` is still coded as *"an advisory model tag … it is
  replaceable and owns nothing"* (`packages/core/src/agent/agent.ts`), i.e. the
  free tag RFC-004 §102 explicitly said to reframe.
- There is **no `model.set` capability** in the catalog — only
  `runtime.set_provider` (Sphere-level).
- The runtime resolution used by chat ignores the per-agent preference:
  `runChatTurn` receives `resolveEffectiveProfile(runtimeConfig).model`
  (`packages/app/api/src/router.ts`) — the Sphere default only — even though
  `resolveEffectiveProfile(config, agentModelPreference)` already supports the
  override.
- No policy is **seeded** that grants model/provider setting to anyone, so the
  governed path is deny-by-default with nothing able to grant it. In practice an
  admin/owner has no path to change an agent's model at all.

This last gap produced a concrete, user-visible failure: a Sphere seeded with the
default model `llama3.2` (not pulled locally) could not be re-pointed through any
governed endpoint, and the runtime failure was mis-reported to the operator. The
product requirement is explicit: **an agent's default model must be governed, and
governable by the admin and the Sphere's owner.**

## Proposal

### The default model is a governed agent setting

- `agent.modelPreference` is **reframed** from an advisory tag to a **governed
  model selection**. Its value must lie within the **Sphere-allowed set** defined
  by the Sphere `RuntimeProfile`/allowed providers (RFC-004): it can never select a
  provider the Sphere has disabled, and cloud selection follows RFC-004's consent,
  minor-denial and disable rules. Setting or clearing it is only possible through
  the governed capability below; the domain mutator (`setModelPreference`) stays
  pure but is never reached except behind a policy check.
- When unset, the agent runs on the **Sphere default** profile. When set, the
  agent's preference overrides the model within the allowed set — resolved by the
  existing `resolveEffectiveProfile(runtimeConfig, agentModelPreference)`.

### New capability `model.set`

A new catalog capability governs changing an agent's default model:

- `name: "model.set"`, `description: "Set an agent's default model (admin/owner)."`
- `allowedProfiles: ["adult"]` — minors can never set a model (invariant 8).
- Local model: `risk: "medium"`, `approvalFloor: false` — an admin/owner change is
  immediate, matching RFC-004 ("local stays low/medium").
- Cloud model: raises to `require_approval` and is **denied by default for minors**,
  reusing RFC-004's cloud rules; selecting a cloud model is an external-transfer
  configuration change, audited accordingly.
- `auditFacts: ["actor", "capability", "agentId", "model", "decision", "correlationId"]`
  — the fact and the chosen model id (configuration, not conversation content) are
  recorded; never the prompt/response (coding principle 6).

A capability **binding** maps `model.set` to a local executor that validates the
requested model against the Sphere-allowed set and writes `agent.modelPreference`.

### Who may govern it: administrators (founder/owner included)

- Authorisation is by the Sphere's **administrators** (`Sphere.administrators`).
  The **founder is auto-recorded as the first administrator**
  (`packages/core/src/sphere/sphere.ts`), so "admin **and** the Sphere's owner" is
  exactly the administrator set — no new role is introduced (roles remain
  `parent | teenager | child | guest`).
- A **default admin policy is seeded** for `model.set`, mirroring
  `defaultAdminPolicies` (RFC-008): administrators may execute `model.set`. This
  closes the "no governed path" gap so the setting works out of the box, and — being
  an ordinary versioned, editable policy — can be narrowed to specific administrator
  member-ids or widened later. Removing it removes the ability (deny-by-default).

### Governed endpoint + admin UI

- `POST /spheres/:id/agents/:aid/model  { subject, model }` — governed: it resolves
  identity, runs the `model.set` policy check, validates the model against the
  Sphere-allowed set, then writes `agent.modelPreference`. It mints no runtime
  token and touches no memory. Denials are real `403`s with the policy reason;
  disallowed/unavailable models are `400`/`403` at configuration time.
- The RFC-003 admin console gains a per-agent model selector that triggers this
  endpoint and lists Sphere-allowed models (display-only discovery, RFC-004 §"Model
  discovery").

### The runtime path honours the preference

- The chat/turn path passes the agent's `modelPreference` into
  `resolveEffectiveProfile(runtimeConfig, agentModelPreference)` instead of
  resolving the Sphere default alone. The same holds for any future agent-run path.
- A model that is configured but unavailable at inference time (e.g. not pulled in
  Ollama) surfaces as a **runtime error at use**, not a masked authorization error
  — consistent with separating authorization from execution failures.

### Boring swap preserved

Changing an agent's model changes only the runtime selection. Canonical memory,
policies, bindings, identities and sessions are untouched (coding principle 9;
invariants 2, 26). The same capability requests resolve identically; only the
executing model differs.

## Domain impact

- **Agent entity**: `agent.modelPreference` semantics change from advisory tag to
  governed selection constrained by the Sphere-allowed set. No structural field
  change is required; `domain-model.md` and `agent.ts` docs are updated to drop the
  "advisory / owns nothing" framing for the governed framing.
- **Capability catalog**: add `model.set` (local medium / cloud approval, adult-only,
  minor-denied cloud) with its audit facts; add its local binding.
- **Provisioning seed**: add a default admin policy granting `model.set` to
  administrators (founder/owner included), alongside the existing provisioning seed.
- **Runtime resolution**: the chat/agent-run path passes the agent preference to the
  already-existing `resolveEffectiveProfile` override; no new resolver logic.
- No change to memory, policy evaluation semantics, or capability execution.

## Security and privacy impact

- **Deny by default** (coding principle 6): without the seeded (or an explicit)
  policy, no one may set a model; the capability floor already denies minors.
- **Admin/owner-only, no privilege widening**: governance is the administrator set;
  the owner governs *because* the founder is an administrator, so nothing outside the
  existing admin authority is granted (invariants around least privilege).
- **Cloud stays governed** (RFC-004, invariants 13/14): selecting a cloud model is
  approval-gated, minor-denied, dis- able entirely, and audited as an
  external-transfer configuration change; secrets stay in the secret store by
  reference.
- **Audit minimally** (coding principle 6, invariant): `model.set` records the actor,
  agent, chosen model id and decision under a correlation id — configuration facts,
  never conversation content.
- **Model owns nothing** (invariants 2, 26; coding principle 9): the swap is boring;
  memory and policy are untouched.
- **Prompt is not a boundary** (coding principles 2, 4): only policy-scoped memory
  reaches any model; changing the model never widens access.

## Alternatives considered

- **Keep `modelPreference` advisory.** Rejected: RFC-004 (Accepted) already requires
  it to be a governed selection; leaving it advisory means an ungoverned setting can
  steer which model runs.
- **Govern by the per-agent owner (`agent.ownerId`) instead of Sphere admins.**
  Rejected for this RFC per the accepted scope decision: "the Sphere's owner" is the
  founder, who is an administrator; the agent's default model is a Sphere-admin
  concern. Per-agent-owner self-service can be added later as an additional policy
  without changing this design.
- **Introduce a distinct `owner` role.** Rejected: the founder is already an
  administrator, so the administrator set expresses "admin + owner" without expanding
  the role model.
- **Reuse `runtime.set_provider` for per-agent model.** Rejected: that capability is
  Sphere-level provider/model; per-agent selection is a distinct, lower-risk (local)
  action that should not require changing the whole Sphere's provider.

## Open questions

- Per-capability model routing (summarize local, draft cloud) — inherited open
  question from RFC-004; out of scope here.
- Management UI for the Sphere-allowed model set (the allow-list itself), as distinct
  from selecting within it.
- Whether an owner who is later removed from `administrators` should retain model
  governance. Per the accepted scope (founder = owner = admin), they govern via
  administrator membership and lose it if removed; revisit if owners must persist
  independently of admin rights.

## Acceptance criteria

- `agent.modelPreference` is documented and enforced as a governed selection
  constrained to the Sphere-allowed set; a value outside that set is rejected.
- A `model.set` capability exists (adult-only; local immediate/medium, cloud
  approval-gated and minor-denied) with a local binding that validates against the
  Sphere-allowed set and writes the preference.
- A default admin policy is seeded so the Sphere's administrators (founder/owner
  included) can set an agent's model out of the box; removing it removes the ability.
- A governed endpoint `POST /spheres/:id/agents/:aid/model` performs the policy
  check + validation and updates the preference, and the RFC-003 console exposes it.
- The chat/agent-run path resolves the agent's model via
  `resolveEffectiveProfile(runtimeConfig, agentModelPreference)`; a set preference
  actually changes the model used.
- Changing an agent's model requires no memory migration and no policy change; a
  minor can never set a model; cloud selection follows RFC-004's consent/minor rules
  and is audited as an external transfer.
- Setting a model that is unavailable at inference time surfaces as a runtime error
  at use, never as an authorization error.
