# ADR-000 — Sphere Model

## Status

Accepted.

## Context

KinOS started from the family use case: one agent per person, shared memory, private memory and family governance. During design, it became clear that the core concepts are not family-specific.

Memory, identity, policy, consent, capabilities, integrations and audit apply to any governed human collective.

## Decision

KinOS uses **Sphere** as the primary domain abstraction.

A Sphere is a governed unit of human representation.

A Sphere may represent:

- a person;
- a family;
- a team;
- a company;
- an association;
- a school;
- an institution;
- another human collective.

A Sphere can own or control:

- members;
- agents;
- memory;
- policies;
- capabilities;
- integrations;
- audit boundaries.

Spheres can be members of other Spheres. The resulting model is a governed graph, not only a tree.

## Consequences

The domain model must not hard-code `Family` as the root concept. Family is represented as `Sphere(type = family)`.

Terms like Family Agent, Family Memory and Family Policies become specific UI labels or presets. The domain terms are Sphere Agent, Sphere Memory and Sphere Policies.

## Non-goals

This ADR does not define storage schema, UI navigation or billing units.

## Implementation constraints

- Every domain entity that belongs to a collective must reference a Sphere.
- Roles are scoped to a Sphere.
- Permissions are evaluated in the context of a Sphere.
- Agent identity is distinct from Sphere identity.
- Shared memory does not erase original ownership.
