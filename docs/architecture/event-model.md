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

## Audit vs telemetry

Audit events support trust and accountability. Telemetry supports product improvement. They must be separate systems with separate consent rules.
