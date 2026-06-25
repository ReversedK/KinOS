# RFC-001 — Sphere-first Architecture

## Status

Accepted.

## Summary

KinOS should use Sphere as its primary domain abstraction instead of Family.

## Motivation

The original product idea started with families, but the core problems are broader: representation, memory, governance, permissions, capabilities and consent in human collectives.

## Proposal

Introduce Sphere as the root domain concept. Family becomes one Sphere type.

## Domain impact

Affected concepts:

- Sphere;
- Member;
- Agent;
- Memory;
- Policy;
- Capability;
- Integration.

## Security and privacy impact

Sphere-scoped policies allow privacy and permissions to be evaluated consistently across families, teams and organizations.

## Alternatives considered

Hard-code Family as the root concept. Rejected because it would limit the architecture and require later migration.

## Acceptance criteria

- Domain model uses Sphere.
- Results contract refers to Sphere.
- ADR-000 records the decision.
- Family is implemented as a Sphere type.
