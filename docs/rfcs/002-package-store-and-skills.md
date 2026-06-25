# RFC-002 — Package Store and Skills

## Status

Draft — proposed.

## Summary

KinOS distributes agent extensions as **Packages** through a curated store, installable in one click from the web UI. A Package is the unit of distribution; it has a type (`skill`, `mcp`, or `bundle`), a plain-practical description of what it lets an agent do, and declared dependencies that install resolves and dedups. This RFC also defines the **Skill** — the agent-competence concept previously left open — as a package type.

Install makes capabilities available and runs a guided grant wizard, but never grants use by itself: every call stays Policy-Engine-gated, and minors are denied by default.

## Motivation

Agents become useful by gaining new competences and connecting to new systems. KinOS already has the internal pieces — Capabilities (the internal API), Integrations/MCPs (adapters), Capability Bindings, the Policy Engine — but no defined way to *acquire* a competence as a product. Users should not assemble capabilities, bindings and policies by hand. They should browse a store, read "this lets your agent build a themed amusement park in Minecraft", click install, and have the dependencies, capabilities and safe default policies set up for them.

This must happen without weakening the invariants: install is not authorization, third-party code must be trusted and contained, and minors stay protected by default.

## Proposal

### Package

A **Package** is the distributable store unit. The user-facing and domain term is "Package".

Types:

- **`skill`** — an agent competence: instructions/competence definition + the set of capabilities it uses + optional workflow/orchestration. A skill composes existing capabilities; it never defines permissions and never grants its own rights. This is the definition of "Skill" in KinOS.
- **`mcp`** — an Integration adapter (an MCP server), implementing one or more capabilities. "MCP" remains an Integration in domain terms (`docs/architecture/integration-model.md`).
- **`bundle`** — a package with no payload of its own that exists only to depend on other packages (a convenience grouping).

Packages declare **dependencies** on other packages, version-ranged. Installing a package resolves its dependency graph against what the Sphere already has and **dedups** — an already-present dependency at a satisfying version is reused, not reinstalled. Example: the amusement-park package is `type: skill` and depends on the Minecraft `mcp` package; installing it installs the Minecraft MCP only if absent.

**Capabilities remain the internal API.** A skill references capability names (e.g. `minecraft.build_structure`), never raw MCP tool names. Installing an `mcp` package registers the capabilities it provides into the Sphere's capability catalog (`docs/domain/capability-catalog.md`) with the package-declared risk level. A Sphere policy may raise that risk or restrict further; it is never silently lowered. New capabilities follow the existing catalog acceptance rules.

### Package manifest

Every package declares:

```ts
type PackageManifest = {
  id: string;                 // stable, e.g. 'minecraft-themepark'
  type: 'skill' | 'mcp' | 'bundle';
  title: string;              // human title
  description: string;        // plain, practical: what it lets the agent do
  version: string;            // semver
  publisher: string;
  signature: string;          // store/publisher signature; verified at install
  verificationLevel: 'verified';      // MVP: verified only
  ageRating: 'all' | 'teen' | 'adult';
  dependencies: Array<{ packageId: string; versionRange: string }>;
  providesCapabilities?: Array<{       // for mcp/skill packages adding capabilities
    name: string;
    risk: 'low' | 'medium' | 'high' | 'critical';
    inputSchema: object;
    outputSchema: object;
  }>;
  requiresCapabilities?: string[];     // capability names the package consumes
  requiredScopes?: string[];           // human-readable, shown at install
  sandbox?: { runtime: string; isolation: 'container' };  // for mcp code
  defaultPolicies: PolicyPreset[];     // what the grant wizard pre-fills
  audit: { facts: string[] };          // metadata to record, never content
};
```

The `description` is contractually plain-language and practical — it states what the package adds to the agent, not how. `defaultPolicies` are presets the install wizard proposes (see below); they are not active until the admin confirms.

### Install pipeline

Installing is a governed, audited admin action carried out from the web UI under one correlation id:

```text
admin clicks Install
  -> resolve dependency graph (curated store), dedup against Sphere
  -> verify signatures and check ageRating against Sphere members
  -> provision sandbox for any `mcp` package (isolated container)
  -> register provided capabilities + create Capability Bindings (DISABLED)
  -> guided grant wizard: propose defaultPolicies (adults allow, minors deny)
  -> admin confirms (one-click = accept defaults; advanced = scope to roles/members/agents)
  -> activate the resulting policies
  -> enable the Capability Bindings
  -> emit PackageInstalled audit event(s)
```

Key rule: **install makes a capability available; it does not authorize use.** Bindings are created disabled; only the policies the admin confirms in the grant wizard authorize anyone, and the Policy Engine still evaluates every individual call at runtime. A package can be installed Sphere-wide while being usable only by some members.

### Guided grant wizard

The wizard turns the package's `defaultPolicies` into concrete Sphere policies the admin reviews:

- safe defaults pre-filled: adult profiles allowed (subject to risk/approval floors), **minor profiles denied by default**;
- one-click accepts the defaults; an advanced path scopes the grant to specific roles, members or agents;
- the result is ordinary Policy Engine policies (`docs/adr/003-policy-engine.md`), versioned and auditable; nothing about the package bypasses or replaces policy evaluation.

### Trust and safety

The MVP store is **curated**:

- packages are reviewed and **signed** by KinOS or a trusted publisher; signatures are verified at install;
- each package carries a `verificationLevel` (MVP: `verified` only) and an `ageRating`;
- `mcp` packages run **sandboxed** in isolation (container), so a failing or misbehaving package cannot compromise the Sphere (invariant 24);
- an `mcp` that calls external services is subject to external-transfer evaluation (`docs/security/privacy-model.md`) and the secret-store rules (`docs/architecture/secret-store.md`);
- browsing and installing from the store is an online action; installed packages and their sandboxes then run locally, so the core stays usable offline (invariant 13 — cloud optional).

### Package lifecycle

`available (store) → installed → enabled → disabled → uninstalled`. Disabling a package disables its bindings and blocks future use while retaining audit history; uninstalling removes bindings and sandbox while keeping audit facts. Revocation/disable blocks the future, not the past (invariant 5). Dependencies are not removed while another installed package still requires them.

### Plugin SDK reconciliation

This RFC revises `docs/architecture/plugin-sdk.md`. A Package is the distribution and lifecycle wrapper around the plugin types the SDK already lists (capability plugins, integration adapters) plus Skills. On acceptance:

- "dynamic remote plugin installation" moves **in scope**, but only for **curated + signed + sandboxed** packages;
- "public plugin marketplace" and "third-party untrusted code execution" remain **out of scope (v2)**.

## Domain impact

- New domain concept **Package** (with type, manifest, dependencies, lifecycle); to be added to `domain/domain-model.md` and `domain/entity-lifecycle.md`.
- **Skill** defined as the `skill` package type; closes the previously-open Skills concept.
- **Capability Catalog**: packages may register new capabilities at install with declared risk; existing acceptance rules and default-deny apply.
- **Capability Binding**: install creates bindings (initially disabled) mapping package capabilities to the sandboxed MCP or skill workflow.
- **Policy**: the grant wizard emits ordinary Sphere policies; no new authorization mechanism.
- New capabilities likely needed: `package.install`, `package.uninstall`, `package.disable` (all high-risk, admin-only, approval-gated), and `store.browse` (low).

## Security and privacy impact

- **Install ≠ authorization** (invariants 6, 7): bindings start disabled; only confirmed policies grant use.
- **Minors** (invariant 8): denied by default in the wizard; `ageRating` gates what is even offered for a minor.
- **Third-party code** (invariant 24): curated, signed and sandboxed; failure is contained to the package.
- **External transfer** (invariant 14): MCP calls leaving the device are evaluated and audited; credentials follow the secret store, never the manifest.
- **Audit** (invariant 16): install, grant, enable, disable and uninstall are recorded as security facts under a correlation id; no private content.
- **Capabilities are the internal API** (invariant 27) and **MCPs are replaceable adapters** (invariant 30): skills bind to capability names, not MCP tool names.

## Alternatives considered

- **Package == Skill, MCPs as silent dependencies.** Rejected: you could not browse or install an MCP on its own, and dedup/versioning of shared MCPs across skills becomes implicit and hard to govern.
- **Two separate catalogs (Skills vs MCPs) with no shared abstraction.** Rejected: duplicates lifecycle, dependency and trust handling; the umbrella Package unifies them.
- **Install grants use to the Sphere by default.** Rejected: inverts deny-by-default and minor protection (invariants 6, 7, 8).
- **Open marketplace at MVP.** Rejected for MVP: contradicts current plugin-sdk non-goals and raises minor-safety and supply-chain risk; deferred to v2.

## Open questions

- Versioning and upgrade: how are package upgrades reviewed and rolled out, and can an upgrade change declared risk or required scopes without re-consent? (Likely: risk/scope increase forces re-consent.)
- Publisher trust model for the `verified` tier: who may publish, and how is signing-key trust managed?
- Cross-Sphere reuse: sharing an installed package or its sandbox across nested Spheres is tied to cross-Sphere evaluation, which is **v2** (see RFC-001); MVP installs per Sphere.
- Open/unverified tier and an eventual public marketplace — v2.

## Acceptance criteria

- A Package is defined with types `skill | mcp | bundle`, a manifest, version-ranged dependencies, and a lifecycle; `domain-model.md` and `entity-lifecycle.md` are updated.
- "Skill" is defined as the `skill` package type and the parked Skills gap is closed.
- Installing a package resolves and dedups dependencies and installs an absent `mcp` dependency.
- Install creates capabilities/bindings **disabled**; use is authorized only by policies confirmed in the grant wizard and evaluated per call by the Policy Engine.
- Minor profiles are denied by default at install; `ageRating` gates what is offered.
- Store packages are signed and verified at install; `mcp` code runs sandboxed; external calls are audited.
- `plugin-sdk.md` is updated to allow curated+signed+sandboxed dynamic install while keeping public marketplace and untrusted code as v2.
- Install/grant/enable/disable/uninstall emit minimal audit events under a shared correlation id.
