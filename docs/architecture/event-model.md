# KinOS — Event Model

## Purpose

KinOS is policy-heavy and audit-heavy. Events provide traceability without turning logs into private data dumps.

## Event principles

- Events are facts, not conversations.
- Events are minimal.
- Events carry correlation IDs.
- Events must be safe to inspect by authorized administrators.
- Sensitive content should be referenced, classified or redacted, not copied.

## Common event fields

```ts
type KinEvent = {
  id: string;
  type: string;
  sphereId: string;
  actorId?: string;
  agentId?: string;
  resourceType?: string;
  resourceId?: string;
  decision?: 'allow' | 'deny' | 'require_approval' | 'executed' | 'failed';
  reason?: string;
  correlationId: string;
  createdAt: string;
};
```

## Correlation chaining

A single sensitive action produces a chain of events sharing one `correlationId`, generated at request entry and threaded through policy check, approval, runtime call and integration call. From that id an auditor can reconstruct: who asked, which policy version decided, whether approval was required and by whom it was answered, what executed and through which integration — without reading any private content.

Example chain for one purchase:

```text
capability.requested  -> capability.denied? no
require_approval (policy) -> approval.requested -> approval.granted
capability.allowed -> capability.executed
external_transfer.requested -> external_transfer.allowed
```

All carry the same `correlationId`; each carries the deciding policy id/version where relevant.

## Initial event types

- sphere.created
- member.invited
- member.joined
- member.removed
- agent.created
- agent.disabled
- memory.created
- memory.shared
- memory.revoked
- memory.deleted
- policy.created
- policy.activated
- policy.disabled
- capability.requested
- capability.allowed
- capability.denied
- capability.executed
- approval.requested
- approval.granted
- approval.denied
- integration.enabled
- integration.disabled
- external_transfer.requested
- external_transfer.allowed
- external_transfer.denied
- identity.impersonated *(dev-only; records the impersonated member and the developer — RFC-006)*
- runtime.token.provisioned *(ADR-007; records sphere/agent + secretRef id, never the token value)*
- runtime.token.rotated *(ADR-007; secretRef id stable across rotation, never the value)*
- runtime.token.revoked *(ADR-007; future resolution denied; past usage remains as facts)*

## What an event may and may not carry

May carry: ids, types, Sphere/actor/agent references, resource type and class, sensitivity class, decision, deciding policy id/version, a user-safe reason, correlation id, timestamp.

Must not carry: full conversation text, raw memory content, message bodies, credentials, secrets or provider tokens. Sensitive resources are referenced by id and classification, never copied.

A `reason` is user-safe: it names the policy and the decision class, not the private content that triggered it. `policyId`/`policyVersion` and `cost`/`execution` (local/cloud) may extend the common fields where relevant.

## Audit vs telemetry

Audit events support trust and accountability. Telemetry supports product improvement. They must be separate systems with separate consent rules. Telemetry must never become a copy of audit content, and audit must never be repurposed as analytics on private behavior.
