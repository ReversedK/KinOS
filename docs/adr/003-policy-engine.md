# ADR-003 — Policy Engine

## Status

Draft accepted for MVP direction.

## Context

KinOS handles personal agents, Sphere agents, private memory, shared memory, minors, integrations and external actions. Safety cannot be delegated to prompts or models.

## Decision

KinOS uses a dedicated Policy Engine as the authority for access control, capability execution and approval requirements.

The Policy Engine evaluates:

- subject: who or which agent requests;
- action: read, write, share, execute, approve, export;
- resource: memory, capability, integration, document, Sphere;
- context: Sphere, role, age profile, time, risk, model, cloud/local status;
- effect: allow, deny, require approval.

## Evaluation order

1. Resolve identity.
2. Resolve Sphere context.
3. Resolve role and age profile.
4. Resolve resource classification.
5. Evaluate explicit deny rules.
6. Evaluate explicit allow rules.
7. Evaluate approval requirements.
8. Deny by default.

## Policy examples

- Children cannot execute external messaging capabilities.
- Purchases require approval.
- Private memory is readable only by owner unless explicitly shared.
- Cloud model use requires explicit consent.
- High-risk capabilities require audit.

## Consequences

- No permission logic in prompts.
- No direct MCP call without policy evaluation.
- No default access to memory or tools.
- Every sensitive denial must be explainable.
