# RFC-008 — Governed Provisioning and Bootstrap

## Status

Accepted.

## Summary

RFC-003 established that the UI may *trigger* governed write actions and named
"manage members / agents" and "update Sphere settings" as part of its write
surface, pointing at `api-contract.md` §Sphere/§Member/§Agent. Those operations
are not yet expressed as capabilities in the catalog, and one of them —
**creating a Sphere** — cannot be authorized the way every other capability is,
because at creation time there is no Sphere, no policy set, and no administrator
to gate it.

This RFC pins RFC-003's admin table down to concrete, catalog-declared,
policy-checked **provisioning capabilities** (`sphere.create`, `member.invite`,
`agent.create`, `agent.update_config`), and defines the **bootstrap** rule that
makes them authorizable without inverting deny-by-default:

1. **Instance bootstrap.** `sphere.create` is authorized at the *instance*
   boundary by a fixed **bootstrap policy set** — the local operator (the human
   with local access to this KinOS instance) is the root of trust for bringing a
   Sphere into existence. It is not, and cannot be, gated by a per-Sphere policy.
2. **In-Sphere admin seed.** Creating a Sphere seeds a **default administrative
   policy set** that grants the founder/administrators (and only them) the
   in-Sphere provisioning capabilities. Without this seed the founder would be
   denied-by-default from ever adding a member — a second chicken-and-egg.

Everything else follows the existing governed pipeline unchanged: provisioning
capabilities bind to a local-executor tool whose side effect mutates the
`SphereStore` (the exact pattern RFC-007 used for `runtime.config.project`), and
every call is policy-checked, audited as security facts, and carries a
correlation id.

## Motivation

`results-contract §2` requires that "an administrator can create a Sphere in
less than five minutes", and `§19` (MVP validation) requires that a Sphere can
be created, two adults and one child added, and each member given an agent.
Today those steps exist **only** as out-of-band CLI/core factory calls
(`initSphere`, `seedDemoSphere`, `createSphere`, `createAgent`) that write the
store directly, bypassing the Policy Engine, audit and correlation. RFC-003
already decided the UI is the intended admin surface for them but deliberately
left "manage members / agents" as a pointer to the api-contract rather than a
concrete governed capability. This RFC closes that gap so the UI can create a
Sphere and deploy a permissioned agent **through** the governed pipeline, not
around it.

## Proposal

### New capabilities (added to the catalog)

All are **admin-scoped, high-risk, adult-only** by default; the Policy Engine
still gates every call and may raise any of them to `require_approval`. Deploying
an agent with a capability in scope is **not** the same as authorizing that
capability — every capability the agent later requests is independently
policy-checked per call (defense in depth; invariants 3, 6).

| Capability | Action | Risk | Approval floor | Notes |
|---|---|---|---|---|
| `sphere.create` | create a Sphere | high | none | **instance-scoped** (bootstrap); founder becomes first administrator |
| `member.invite` | add a member (role + identity) | high | none | in-Sphere admin; minors restricted by default downstream |
| `agent.create` | deploy an agent with a capability scope | high | none | scope is a *request surface*, not an authorization |
| `agent.update_config` | change an agent's capability scope / model / state | high | none | enable/disable capabilities, pause/disable, change model tag (boring) |

`sphere.update_settings`, `member.suspend`/`member.remove`,
`agent.pause`/`agent.disable`, and `capability.bind` remain named in RFC-003 and
the api-contract; they are out of scope for this RFC's first slice and follow the
same shape when added.

### Bootstrap: authorizing `sphere.create`

`sphere.create` is **instance-scoped**, not Sphere-scoped. It is evaluated by the
Policy Engine against a fixed **bootstrap policy set** rather than any Sphere's
policies:

- The bootstrap set grants `execute sphere.create` to an **adult** subject
  (`ageProfile: "adult"`) and denies everything else — deny-by-default is
  preserved; the only thing bootstrap trust can do is create Spheres.
- This encodes the trust-model position that the local operator (top of the
  trust hierarchy: user-owned data → domain core) is the root of trust for an
  otherwise-empty instance. It is deterministic domain data, not a code path that
  skips policy: the same `evaluate()` runs, against a different, explicit set.
- Real operator authentication is out of scope (as in RFC-003); during
  development the actor is the RFC-006 impersonation subject. The bootstrap set
  is where instance-level auth will attach when it lands.

On success the founder is recorded as the first member and administrator
(the core `createSphere` already does exactly this), and the default admin seed
below is installed atomically with the new Sphere.

### In-Sphere admin seed

When a Sphere is created, KinOS installs a **default administrative policy set**
into it so its administrators can provision without a prior manual policy:

- `allow execute` for `member.invite`, `agent.create`, `agent.update_config`
  when `subjectSelector.roles` includes the administrator role(s)
  (`parent`, `admin`) — nothing wider.
- These are ordinary versioned policies (`status: "active"`), visible and
  editable like any other; they are a *seed*, not a hidden privilege. Removing
  them removes the ability, preserving deny-by-default.

This keeps the property that being "admin in the UI" grants nothing the actor's
role does not already grant (RFC-003): the grant is an explicit, auditable policy
in the Sphere, not an implicit UI power.

### Execution shape (unchanged pipeline)

- Each provisioning capability has an **enabled Capability Binding** to a
  local-executor tool (`provisioning.create_sphere`, `provisioning.invite_member`,
  `provisioning.create_agent`, `provisioning.update_agent`). The binding set is
  injected the same way `runtimeGovernanceBindings()` is (RFC-007), so the call
  flows through the per-call policy double-check + catalog/binding approval floor.
- The executor **side effect** performs the store mutation (create the Sphere and
  seed admin policies; add a member; create/update an agent) and returns a
  minimal, non-sensitive result (e.g. the new id). Canonical data stays in the
  domain; the runtime never provisions.
- `sphere.create` runs against an **instance endpoint** (`POST /spheres`, no
  Sphere in the path) with the bootstrap policy set; the in-Sphere capabilities
  run against the existing `POST /spheres/:id/capabilities/:name/execute` path
  with the Sphere's (now seeded) policies.

## Domain impact

- **No new entity.** `Sphere`, `Member`, `Agent` and `Policy` already exist with
  the needed factories (`createSphere` founder-as-administrator, `addMember`,
  `createAgent` + `enableCapability`/`changeModelPreference`). This RFC adds the
  *governed path* to invoke them, plus a `defaultAdminPolicies(sphereId)` helper
  (pure domain) that returns the admin seed.
- **Catalog** gains the four capabilities above with admin-only/high-risk
  defaults (a floor; the engine still governs and never widens).
- **Lifecycle** unchanged: `sphere.create` yields an `active` Sphere
  (entity-lifecycle draft→active "initialized and ready"); `agent.create` yields
  a `configured` agent that `agent.update_config` may activate.

## Security and privacy impact

- **Deny-by-default preserved** (invariants 6, 7; coding principle 6): bootstrap
  grants exactly one thing (`sphere.create`); the admin seed grants exactly the
  named in-Sphere provisioning capabilities to administrators; everything else is
  denied. No path skips `evaluate()`.
- **UI is not the boundary** (invariants 3, 10): the UI triggers `POST /spheres`
  and the execute endpoints; the Policy Engine authorizes. No authorization lives
  in the UI or in a prompt.
- **Deploying ≠ authorizing** (invariants 3, 6): an agent's enabled-capability
  scope is a request surface only; each capability is re-checked per call, so
  deploying an agent with `payment.execute` in scope grants no payment.
- **Minor protection** (invariant 8): `member.invite` records role/age; minors
  stay restricted by default; no provisioning path silently widens a minor's
  access.
- **Audit** (invariant 16): `sphere.created`, `member.invited`, `agent.created`,
  `agent.updated` are recorded as security facts (ids, role, decision), never
  private content, each under one correlation id chaining policy→execution.

## Alternatives considered

- **A privileged bootstrap code path that skips the Policy Engine for
  `sphere.create`.** Rejected: inverts deny-by-default and makes provisioning a
  decision point outside the single authority (invariants 3, 6, 7). The bootstrap
  *policy set* achieves the same enablement while every request still runs
  `evaluate()`.
- **No admin seed; require the founder to author policies before provisioning.**
  Rejected: contradicts `results-contract §2` ("create a Sphere in under five
  minutes") and leaves a fresh Sphere unusable; the seed is explicit and
  editable, not hidden.
- **Keep provisioning CLI-only.** Rejected: contradicts RFC-003 and
  `results-contract §18/§19`; the UI must be able to run a Sphere.
- **Model an agent's capability scope as an authorization.** Rejected: it would
  make deploy a grant and bypass the per-call check (invariant 3). Scope stays a
  request surface.

## Open questions

- Real operator/administrator authentication at the instance boundary (login) —
  deferred to the same future work RFC-003 defers; the bootstrap policy set is
  the attach point.
- Whether `sphere.create` should itself become approval-gated in multi-operator
  deployments (not relevant to the local-first MVP).
- Where the bootstrap policy set lives once multiple instances/federation exist
  (out of scope; local-first single instance for now).

## Acceptance criteria

- The catalog declares `sphere.create`, `member.invite`, `agent.create`,
  `agent.update_config` as admin-only/high-risk; an unknown or non-adult subject
  is denied.
- `POST /spheres` creates a Sphere through the Policy Engine against the bootstrap
  set, records the founder as first administrator, seeds the default admin policy
  set, and audits `sphere.created` under a correlation id. A non-adult subject is
  denied (403).
- With the seed in place, an administrator can `member.invite`, `agent.create`
  (with a capability scope), and `agent.update_config` through the existing
  execute endpoint; a non-administrator is denied by default.
- Deploying an agent with a capability in scope does not authorize that
  capability: a subsequent call still returns the Policy Engine's decision.
- Every provisioning action emits minimal audit facts (no private content) under
  one correlation id.
- The UI performs no authorization the Policy Engine could not reproduce; it only
  triggers the endpoints above (RFC-003).
