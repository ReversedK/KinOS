# ADR-002 — Memory Architecture

## Status

Draft accepted for MVP direction.

## Context

KinOS memory is not chat history. It is durable, structured, owned and governed information that survives model and runtime changes.

The system must support private memory, shared memory, Sphere memory, retrieval, export, deletion and revocation. Memory belongs to the user or Sphere that created it, never to the model. Changing model, provider, runtime or interface must not require migrating memory.

## Decision

KinOS represents memory as structured **Memory Items**. The Memory Item is canonical. Embeddings, indexes, caches and any model-side representation are derived and regenerable from canonical memory. If a derived index is lost, it can be rebuilt; if a canonical item is lost, the memory is lost.

A Memory Item must include:

- id;
- owner identity (member, or Sphere for Sphere-owned memory);
- owning Sphere;
- visibility scope;
- sensitivity level;
- content;
- optional summary;
- source (manual entry, conversation extraction, import, integration);
- creation time;
- update time;
- lifecycle state;
- audit references.

```ts
type MemoryItem = {
  id: string;
  ownerId: string;            // member id, or sphere id for Sphere-owned memory
  ownerType: 'member' | 'sphere';
  sphereId: string;
  visibility: 'private' | 'shared_with_members' | 'shared_with_supervisors'
            | 'shared_with_sphere' | 'public_exportable';
  shareGrants?: Array<{       // explicit grants for shared_with_members
    subjectId: string;        // member or agent
    grantedBy: string;
    grantedAt: string;
    revokedAt?: string;       // set on revocation; grant remains as audit fact
  }>;
  sensitivity: 'normal' | 'sensitive' | 'medical' | 'financial' | 'legal';
  content: string;
  summary?: string;
  source: 'manual' | 'conversation' | 'import' | 'integration';
  createdAt: string;
  updatedAt: string;
  state: 'active' | 'archived' | 'revoked' | 'deletion_requested' | 'purged';
  auditRefs: string[];        // correlation ids of events touching this item
};
```

Embeddings are derived indexes, not canonical memory.

## Memory scopes

Scopes are ordered from most to least restrictive. They describe potential visibility; the Policy Engine still evaluates each access.

- **private** — owner only, plus processes acting strictly for the owner.
- **shared_with_members** — explicitly granted members/agents listed in `shareGrants`.
- **shared_with_supervisors** — available for governance (e.g. parents) without implying total surveillance; supervision is not access to all private content.
- **shared_with_sphere** — visible to the Sphere agent and authorized Sphere members.
- **public_exportable** — marked suitable for export/publication, still subject to a final policy check before any external transfer.

New memory is `private` by default. A scope is never widened by silence or ambiguity; widening requires an explicit `memory.share` action and consent.

## Ownership and sharing

- A shared Memory Item keeps its original owner. Sharing grants access; it never transfers ownership (invariant 20).
- Revocation removes future access for a subject. The original `shareGrant` is retained with `revokedAt` set, so past access remains visible as an audit fact (invariant 5). Revocation does not delete the item or rewrite history.
- Removing a member from a Sphere does not erase memory ownership; member-owned private memory stays under the member's control unless explicit legal/organizational rules apply.

## Retrieval rule

Memory retrieval happens after identity and policy resolution. The Memory Resolver is a consumer of Policy Engine decisions, not an independent gatekeeper.

Flow:

```text
Identity Resolver -> Policy Engine -> Memory Resolver -> (authorized items only) -> runtime/prompt
```

- The Memory Resolver requests, for a given subject and Sphere, the set of items the Policy Engine authorizes for `read`.
- Only authorized items are embedded into context or surfaced to the runtime. A forbidden item must never reach a prompt (invariant 3).
- Retrieval over embeddings is a recall optimization. An embedding match for a non-authorized item is discarded; the embedding index never grants access. Authorization is decided on canonical items and their classification, not on vector similarity.
- If classification is missing or ambiguous, the item is treated as most restrictive and excluded unless an explicit allow applies.

## Conversation-to-memory extraction

Chat logs are not memory by default. Turning conversation into a Memory Item is an explicit or policy-driven step:

- extraction creates a new Memory Item with `source = 'conversation'`, inheriting the owner and a default `private` visibility;
- extraction never auto-shares; widening scope is a separate consented action;
- minors' conversations follow restricted defaults; extraction and any sharing are governed.

## Embeddings and indexes

- Embeddings are built from canonical content/summary and tagged with the item id and owning Sphere.
- They are rebuildable at any time from canonical memory; losing them is recoverable.
- They carry no authority. Access control is enforced on canonical items before results are used.
- On model/provider change, embeddings may be regenerated. Canonical memory does not change. Model replacement stays "boring": no memory migration, no policy change (invariant 2, coding-principle 9).

## Lifecycle

Memory states (aligned with `docs/domain/entity-lifecycle.md`):

- active;
- archived;
- revoked;
- deletion_requested (`deleted_pending_purge`);
- purged.

Rules:

- **Revocation ≠ deletion.** Revocation blocks future access to a share; the canonical item survives and remains owned. Deletion removes the item according to retention rules.
- **deletion_requested** marks an item for purge; access is blocked immediately while retention/legal windows apply.
- **purge** removes the canonical item and its derived indexes (embeddings, caches) where technically possible.
- Embeddings are derived and must follow the canonical item's lifecycle: when an item is revoked, deleted or purged, dependent indexes are updated or removed accordingly.

## Export and portability

- Export uses documented, open formats so memory remains readable over time (invariant 23).
- Export includes canonical items, ownership, visibility, sensitivity and lifecycle state; embeddings are not exported as truth (they are regenerable).
- Export of an item is itself a governed action and may require a policy check and external-transfer evaluation when leaving the local environment.

## Worked examples

- A parent writes a note → Memory Item, owner = parent, visibility `private`. A child agent's `memory.search` never returns it (default deny on private).
- A parent shares a grocery list with the family → `memory.share` adds a Sphere grant; visibility becomes `shared_with_sphere`; ownership stays with the parent. Later `memory.revoke` sets `revokedAt`; the family agent loses future access; the audit fact of prior access remains.
- A medical note is `private` + sensitivity `medical`. Even a supervisor scope does not expose it; the Policy Engine denies (supervision ≠ surveillance).

## Consequences

- Chat logs are not memory by default.
- Memory extraction from conversations must be explicit or policy-driven.
- Embeddings must be rebuilt from canonical memory and never act as an authorization boundary.
- Export must use documented formats.
- Shared memory keeps original ownership; revocation preserves past access as audit facts.
- Changing models requires no memory migration.
```