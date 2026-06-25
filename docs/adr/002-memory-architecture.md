# ADR-002 — Memory Architecture

## Status

Draft accepted for MVP direction.

## Context

KinOS memory is not chat history. It is durable, structured, owned and governed information that survives model and runtime changes.

The system must support private memory, shared memory, Sphere memory, retrieval, export, deletion and revocation.

## Decision

KinOS represents memory as structured Memory Items.

A Memory Item must include:

- id;
- owner identity;
- owning Sphere;
- visibility scope;
- sensitivity level;
- content;
- optional summary;
- source;
- creation time;
- update time;
- lifecycle state;
- audit references.

Embeddings are derived indexes, not canonical memory.

## Memory scopes

Minimum scopes:

- private;
- shared_with_members;
- shared_with_supervisors;
- shared_with_sphere;
- public_exportable.

## Retrieval rule

Memory retrieval happens after identity and policy resolution.

The model only receives memory items already authorized by the Memory Resolver and Policy Engine.

## Lifecycle

Memory states:

- active;
- archived;
- revoked;
- deleted_pending_purge;
- purged.

Deletion and revocation are different. Revocation blocks access. Deletion removes the item according to retention rules.

## Consequences

- Chat logs are not memory by default.
- Memory extraction from conversations must be explicit or policy-driven.
- Embeddings must be rebuilt from canonical memory.
- Export must use documented formats.
- Shared memory keeps original ownership.
