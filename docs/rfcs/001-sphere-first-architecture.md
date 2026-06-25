# RFC-001 — Sphere-first Architecture

## Status

Accepted.

## Summary

KinOS uses **Sphere** as its primary domain abstraction instead of Family. Family becomes one Sphere type. All collective-owned concepts — members, agents, memory, policies, capabilities, integrations and audit — are scoped to a Sphere, and Spheres may be members of other Spheres, forming a governed graph.

## Motivation

The original product idea started with families, but the core problems are broader: representation, memory, governance, permissions, capabilities and consent inside any human collective. The same mechanisms a family needs are needed by teams, organizations, schools, associations and institutions.

Hard-coding Family as the root would force every collective concept to be re-expressed later and would require a migration once non-family Spheres appear. Choosing Sphere first avoids that migration and keeps authorization, memory ownership and audit uniform across collective types.

## Proposal

Introduce Sphere as the root domain concept (defined in ADR-000).

- A Sphere is a governed unit of human representation with a `type` (minimum: person, family, team, organization; list is open).
- A Sphere owns or controls identity, members, agents, memory, policies, capabilities, integrations and audit boundaries.
- Roles, policies and audit are Sphere-scoped.
- Spheres can be members of other Spheres. Sphere-to-Sphere membership grants no automatic access; access stays deny-by-default and policy-evaluated.
- Family is `Sphere(type = family)`. "Family Agent / Memory / Policies" are UI labels and presets over the generic Sphere terms.
- Core domain logic must not branch on `Sphere.type` for authorization.

## Domain impact

Affected concepts (see `domain/domain-model.md`):

- Sphere — becomes the root abstraction and the scope for all collective entities;
- Member — a human or Sphere participating in a Sphere, with Sphere-scoped roles;
- Agent — owned by a member or by a Sphere; identity distinct from both;
- Memory — Sphere-scoped, owner-retained even when shared;
- Policy — Sphere-scoped and evaluated in Sphere context;
- Capability — available per Sphere via capability bindings;
- Integration — enabled and disabled per Sphere.

No new entity is introduced; Family is reduced to a type value rather than a structure.

## Security and privacy impact

- Sphere-scoped policies let privacy and permissions be evaluated consistently across families, teams and organizations using one engine.
- The graph must not leak rights: membership of a Sphere in another Sphere never implies memory or capability access. Access is deny-by-default and policy-evaluated per request (invariant 7).
- Minor protection and bounded supervision (invariants 8, 9) are expressed as Sphere policies, not hard-coded family rules, so they hold in every Sphere type.
- Shared memory keeps its original owner and revocation rules across the graph (invariants 1, 20).
- Because `type` does not drive authorization, a misconfigured or new Sphere type cannot widen access by default.

## Alternatives considered

- **Hard-code Family as the root concept.** Rejected: it limits the architecture to families and forces a later migration when teams and organizations are added.
- **Model collectives as flat groups without a graph.** Rejected: real collectives nest (person in family, team in company), and a flat model cannot express bounded cross-Sphere supervision or membership.
- **Drive authorization from `Sphere.type`.** Rejected: it scatters type-specific branches through the core and makes new types risky; presets over a uniform engine are safer.

## Open questions

**Cross-Sphere graph evaluation is deferred to v2.** The MVP keeps Spheres flat for authorization: every grant is explicit and Sphere-scoped, membership of a Sphere in another Sphere grants no access, and the graph is structural only. The questions below are not resolved for the MVP and will be addressed by a future RFC/ADR when nested-Sphere authorization is taken on.

- How are cross-Sphere requests evaluated when a member belongs to multiple Spheres with conflicting roles? (Tentative: most restrictive wins.) — v2.
- How is graph traversal bounded to avoid implicit transitive grants and cycles in evaluation? — v2.
- Which default policy presets ship per Sphere type, and where are they versioned?

## Acceptance criteria

- Domain model uses Sphere as the root abstraction.
- Results contract refers to Sphere.
- ADR-000 records the decision and the Sphere-as-member-of-Sphere graph.
- Family is implemented as `Sphere(type = family)` with no family-specific core logic.
- No core authorization path branches on `Sphere.type`.
- Sphere-to-Sphere membership grants no access without an explicit, policy-evaluated decision.
