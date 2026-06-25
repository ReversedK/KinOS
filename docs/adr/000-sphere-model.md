# ADR-000 — Sphere Model

## Status

Accepted.

## Context

KinOS started from the family use case: one agent per person, shared memory, private memory and family governance. During design, it became clear that the core concepts are not family-specific.

Memory, identity, policy, consent, capabilities, integrations and audit apply to any governed human collective. Hard-coding `Family` as the root concept would force a later migration once teams, organizations, schools and institutions arrived, and would leave family-specific assumptions baked into authorization and memory ownership.

## Decision

KinOS uses **Sphere** as the primary domain abstraction.

A Sphere is a governed unit of human representation.

### Sphere types

A Sphere has a `type`. The minimum types (from the results contract) are:

- person;
- family;
- team;
- organization.

The manifesto also anticipates couple, company, school, association, institution and eventually any governed human collective. The list is open: a new type adds no new domain concept, only a label and presets. The domain must not branch its core logic on `type`; type drives UI labels, default roles and default policy presets, not authorization mechanics.

### What a Sphere owns or controls

A Sphere owns or controls:

- identity (distinct from any agent or member identity);
- members (humans or other Spheres, each with Sphere-scoped roles);
- agents (member agents and an optional Sphere agent);
- memory (canonical memory items, each with an owner inside or shared into the Sphere);
- policies (Sphere-scoped rules evaluated by the Policy Engine);
- capabilities (which abstract actions are available, via capability bindings);
- integrations (per-Sphere enabled adapters that implement capabilities);
- audit boundaries (what is recorded, and where audit visibility stops).

Ownership is not erased by sharing: a memory item shared into a Sphere keeps its original owner and revocation rules (invariants 1, 20).

### Spheres as members of Spheres — the graph

Spheres can be members of other Spheres. A person belongs to a family; a family may belong to a community; a team belongs to a company. The result is a governed graph, not only a tree:

- membership of a Sphere in another Sphere grants no automatic memory or capability access — access is still policy-evaluated and deny-by-default (invariant 7);
- a parent Sphere does not implicitly read a child Sphere's private memory; supervision is bounded, not total (invariant 9);
- roles, policies and audit are scoped to the Sphere in which they apply; a member's role in one Sphere says nothing about their role in another;
- cycles are not assumed; the graph must be evaluated without granting transitive rights by default.

### Why Family is just `Sphere(type = family)`

Family is one Sphere type, not a special case. Everything a family needs — shared memory, private memory, parent/teen/child/guest roles, minor protection, approvals — is expressed with the generic Sphere mechanisms (members, roles, policies, visibility scopes, capabilities). "Family Agent", "Family Memory" and "Family Policies" are UI labels and presets over Sphere Agent, Sphere Memory and Sphere Policies. Making Family generic means a team or school reuses the same engine with different presets and no migration.

## Consequences

- The domain model must not hard-code `Family` as the root concept. Family is `Sphere(type = family)`.
- Terms like Family Agent, Family Memory and Family Policies become UI labels or presets; the domain terms are Sphere Agent, Sphere Memory and Sphere Policies.
- Every collective-owned entity references a Sphere; roles, policies and audit are Sphere-scoped.
- Sphere-to-Sphere membership requires the Policy Engine to evaluate access across the graph without implicit transitive grants.
- Adding a new Sphere type is a labels-and-presets change, not a core-logic change.

## Non-goals

This ADR does not define storage schema, UI navigation or billing units. It does not define how policies are authored or evaluated (see ADR-003) nor how memory is stored (see ADR-002).

## Implementation constraints

- Every domain entity that belongs to a collective must reference a Sphere.
- Roles are scoped to a Sphere.
- Permissions are evaluated in the context of a Sphere.
- Agent identity is distinct from Sphere identity and from member identity.
- Shared memory does not erase original ownership or revocation rules.
- Sphere-to-Sphere membership must not grant memory or capability access implicitly; access remains deny-by-default and policy-evaluated.
- Core domain logic must not branch on `Sphere.type` for authorization decisions.
