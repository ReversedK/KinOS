# RFC-011 — Governed Capability Binding on Package Enable (completing the RFC-002 grant wizard)

## Status

Accepted (2026-07-16)

## Summary

RFC-002 specifies the package grant wizard — install makes capabilities available
and creates **bindings disabled**; the wizard turns a manifest's `defaultPolicies`
into Sphere policies the admin confirms; enable activates the bindings — but the
implementation stopped at a status flag: `installPackage`/`enablePackage` only set
`InstalledPackage.status`, creating no `CapabilityBinding` and emitting no policy.
So a Sphere never gains a runtime-tool binding, every projected agent surface is
empty, and the governed tool loop (agent → Sphere MCP → policy-checked tool call)
cannot be exercised end-to-end.

This RFC completes RFC-002's flow and pins the concrete decisions it left
abstract. It introduces no new authorization mechanism: bindings are the existing
Capability Binding, grants are ordinary versioned Sphere policies, and the Policy
Engine still decides every call. It is scoped to the MVP one-click default grant.

## Motivation

The gap is load-bearing. Without it:

- `runtime.config.project` always projects an **empty** `allowedTools`, because the
  projection is deny-by-default on unbound capabilities and nothing is ever bound.
- The Sphere MCP `tools/list` returns nothing for any real agent, so `tools/call`
  is unreachable — the ADR-008 governed execution loop cannot be demonstrated.
- Enabling a store package (`family-calendar`) visibly "succeeds" yet grants and
  binds nothing, which is misleading: the product promise of RFC-002 ("click
  install, and the capabilities, bindings and safe default policies are set up for
  you") is unmet.

## Proposal

### 1. The manifest carries its bindings and its default grant

`PackageManifest` gains two fields RFC-002 already anticipated (`defaultPolicies`):

- `bindings: PackageBinding[]` — for each provided capability, the concrete tool
  that implements it: `{ capability, runtimeToolName, runtime, execution, risk,
  requiresApproval? }`. This is a **mechanism mapping only** (coding principle 8):
  the binding says *how* a capability runs, never *who* may run it. A package
  declaring its own tool names does not grant anything.
- `defaultPolicies: PolicyPreset[]` — the grant the wizard proposes:
  `{ description, subjectSelector, capabilityNames, effect }`. Presets are
  **adult-scoped and deny-by-default for minors** (invariant 8); `effect` is
  `allow` or `require_approval`, never a silent grant beyond the preset.

Both are optional; a package with neither (e.g. a pure `bundle`) changes nothing.

### 2. Install creates bindings **disabled**; enable activates them and applies the grant

Two pure core functions (mirroring `provisioningBindings()`):

- `packageBindings(manifest, status): CapabilityBinding[]` — materializes the
  manifest bindings at the given status (`disabled` on install, `enabled` on
  enable). Stable, deterministic; re-running is idempotent by `capability`.
- `packageGrantPolicies(manifest, sphereId): Policy[]` — materializes the presets
  into concrete active Sphere policies with stable ids
  (`pol_<sphere>_pkg_<pkgId>_<n>`), version 1, `action: "execute"`.

Lifecycle wiring (in the governed API handlers, which already policy-check
`package.install` / `package.enable` / `package.disable`):

- **install** → merge `packageBindings(manifest, "disabled")` into `sphere.bindings`.
  Nothing is authorized (bindings disabled + no grant policy). Install ≠ authorize.
- **enable** → flip those bindings to `enabled` **and** merge
  `packageGrantPolicies(manifest, sphereId)` into `sphere.policies` (skipping any
  already present, by id — idempotent re-enable).
- **disable** → flip the package's bindings to `disabled`. That alone blocks future
  use: the projection and `tools/list` require an *enabled* binding, so a disabled
  binding is deny-by-default. The grant policies are left in place (inert without an
  enabled binding) rather than deleted, so audit/history is undisturbed; an admin
  may disable them explicitly. Revocation blocks the future, not the past
  (invariant 5).

### 3. Enable is the MVP grant confirmation (one-click default)

RFC-002 describes a distinct wizard step where the admin confirms/scopes the grant.
For the MVP, the admin's **enable action is the confirmation**, applying the
manifest's default presets ("one-click accepts the defaults" — RFC-002 §Guided
grant wizard). This is governed: enable is admin-gated and policy-checked, and the
emitted policies are ordinary editable Sphere policies (edit/disable to scope or
revoke). The **advanced path** — scoping the grant to specific roles/members/agents
before applying, and a separate confirm step distinct from enable — is deferred.

### 4. Nothing here weakens the standing invariants

- **Deny by default / install ≠ authorize** (invariants 6, 7): bindings are created
  disabled; only enable — an admin, policy-checked action — activates them and adds
  a grant; the Policy Engine still evaluates every individual call at the Sphere MCP.
- **Minors** (invariant 8): presets are adult-scoped; the catalog profile floor
  still denies a minor even if a preset were mis-scoped.
- **Bindings are mechanism, not authorization** (coding principle 8): the manifest
  maps a capability to a tool; permission remains the policy's job.
- **Audit** (invariant 16): install/enable/disable already emit security-fact events
  under a correlation id; the added bindings/policies are covered by the same facts.

## Domain impact

- `PackageManifest`: new optional `bindings` and `defaultPolicies`.
- New pure functions `packageBindings`, `packageGrantPolicies` (+ `PackageBinding`,
  `PolicyPreset` types), exported from the core package barrel.
- `store-catalog`: `family-calendar` gains concrete bindings
  (`calendar.read` → `local.calendar_read`, `calendar.create_event` →
  `local.calendar`) and an adult-allow default grant. Other catalog entries are
  unchanged (no bindings/presets → no behaviour change).
- App layer: the `packages/install` and `packages/:id/enable|disable` handlers
  persist bindings/policies; `main.ts` registers a `local.calendar_read` handler
  (a demo read returning sample events — a stand-in for a real calendar
  integration, which is out of scope here).
- No change to the Policy Engine, the projection contract, the Sphere MCP contract,
  tokens, or memory.

## Security and privacy impact

- The authorization surface only ever grows through an **admin, policy-checked
  enable**, and only by the manifest's declared adult-scoped presets — never
  silently. Disabling or editing the emitted policies revokes going forward.
- A compromised store package still cannot self-authorize: its `bindings` are
  mechanism only, and its `defaultPolicies` are visible, ordinary policies an admin
  applies knowingly and can remove. The MVP store is curated/signed (RFC-002), which
  remains the trust anchor for what manifests may declare.
- The `local.calendar_read` demo handler returns synthetic data and touches no real
  calendar; a real integration is a separate, later adapter.

## Alternatives considered

- **Fold the grant into a separate `package.grant` capability/endpoint.** Cleaner
  match to RFC-002's distinct wizard step, but adds a capability and a round-trip for
  no MVP benefit; enable-as-confirmation is the documented one-click default. The
  separate step is deferred, not rejected.
- **Auto-enable bindings on install.** Rejected: inverts install ≠ authorize
  (invariants 6, 7).
- **Delete grant policies on disable.** Rejected: disabling the bindings already
  blocks the future; deleting policies loses the admin's scoping and muddies audit.
- **Infer the binding tool from a naming convention** instead of declaring it on the
  manifest. Rejected: implicit mapping is fragile and hides what a package will run;
  an explicit declaration is auditable.

## Open questions

- The advanced grant path (per-role/member/agent scoping, a confirm step distinct
  from enable): its own slice.
- Should `disable` also set the emitted grant policies to `status: "disabled"` for
  tidiness, given the disabled binding already blocks use?
- Real integration adapters behind provided capabilities (a genuine calendar MCP)
  replacing the `local.calendar_read` demo handler.

## Acceptance criteria

- Installing a package with bindings creates them **disabled**; no agent surface
  changes and no grant policy is added (install ≠ authorize).
- Enabling it flips its bindings to **enabled** and adds its adult-scoped grant
  policies; re-enabling is idempotent.
- After enabling `family-calendar`, a parent-owned agent's projected surface and the
  Sphere MCP `tools/list` include `calendar.read`, and `tools/call calendar.read`
  executes through the Policy Engine and returns a result.
- A minor is still denied the capability; a forged/absent Sphere-MCP token is still
  rejected.
- Disabling the package empties the surface again (disabled binding → deny by
  default).
