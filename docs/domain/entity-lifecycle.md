# KinOS — Entity Lifecycle

## Purpose

This document defines the minimum lifecycle states for core KinOS entities. Lifecycles prevent deletion, revocation, disabling and archiving from being confused.

Two rules apply to every lifecycle below:

- **Revocation, disabling and archiving block future use; they do not erase the past.** Audit facts and ownership survive.
- **State transitions on governed entities are themselves governed** and emit audit events carrying a correlation id.

## Sphere lifecycle

States:

- draft;
- active;
- suspended;
- archived;
- deletion_requested;
- deleted.

Transitions:

- draft → active (initialized and ready);
- active → suspended (governance hold; agents and capabilities paused, memory preserved);
- active/suspended → archived (read-only);
- any → deletion_requested → deleted (after export window and retention rules).

Rules:

- archived Spheres are read-only by default;
- deletion must not silently delete member-owned private memory; member-owned memory follows the Member rules below;
- export must be available before deletion when legally and technically possible.

## Member lifecycle

States:

- invited;
- active;
- suspended;
- left;
- removed;
- anonymized.

Rules:

- removing a member from a Sphere does not erase memory ownership;
- member private memory remains controlled by the member unless explicit legal/organizational rules apply.

## Agent lifecycle

States:

- configured;
- active;
- paused;
- disabled;
- exported;
- deleted.

Rules:

- disabling an agent does not delete memory;
- changing runtime or model does not create a new agent identity unless explicitly requested.

## Memory lifecycle

States:

- active;
- archived;
- revoked;
- deletion_requested;
- purged.

Transitions:

- active → archived (kept, not surfaced by default);
- active → revoked (a share is withdrawn; the item itself remains owned and may stay active for the owner);
- active/archived → deletion_requested → purged.

Rules:

- revocation blocks future access but does not delete canonical memory; the prior grant remains as an audit fact;
- deletion is distinct from revocation: deletion targets the item, revocation targets a share;
- deletion_requested blocks access immediately while retention/legal windows apply;
- purge removes canonical memory and derived indexes where possible;
- embeddings are derived and must follow the canonical item's lifecycle (revoke/delete/purge cascade to indexes).

## Policy lifecycle

States:

- draft;
- test;
- active;
- disabled;
- superseded;
- archived.

Transitions:

- draft → test (evaluated only against simulated/replayed requests, never live);
- test/draft → active (explicit activation; never automatic);
- active → superseded (a new version replaces it; editing an active policy creates a new version);
- active → disabled (removed from evaluation; re-activatable);
- disabled/superseded → archived (audit history only).

Rules:

- active policies are versioned;
- activation is always explicit; a policy is never silently promoted from draft or test;
- policy changes must be auditable and emit events;
- a policy can be tested against simulated requests before activation;
- a disabled or superseded policy stops affecting live decisions but its past decisions remain in audit.

## Approval request lifecycle

States:

- pending;
- granted;
- denied;
- expired;
- cancelled.

Transitions:

- (created by a Policy Engine `require_approval` decision) → pending;
- pending → granted (quorum of eligible approver grants reached);
- pending → denied (any eligible approver denies, or quorum becomes unreachable);
- pending → expired (expiry passes with no resolution);
- pending → cancelled (the requesting subject withdraws the action before resolution).

Rules:

- the suspended action does not run while pending; it proceeds only on `granted`;
- `expired` resolves exactly as a denial; the action does not run;
- a `granted` approval is single-use and authorizes only the one pending action;
- the requesting subject cannot approve their own request, and an agent never approves;
- every transition emits a minimal audit event sharing the originating correlation id.

See `docs/adr/004-approval-and-escalation-model.md`.

## Capability binding lifecycle

States:

- proposed;
- enabled;
- disabled;
- deprecated;
- removed.

Rules:

- disabling a binding blocks future execution;
- historical audit remains readable after removal.

## Package lifecycle

States:

- available (in the store, not yet installed);
- installed;
- enabled;
- disabled;
- uninstalled.

Transitions:

- available → installed (dependencies resolved and deduped; capabilities and bindings registered, bindings created disabled);
- installed → enabled (the install grant wizard's confirmed policies activate; bindings enabled);
- enabled → disabled (use blocked; bindings disabled; audit retained);
- installed/disabled → uninstalled (bindings and sandbox removed; audit facts retained).

Rules:

- install never grants use; only confirmed policies authorize, and the Policy Engine still gates each call;
- a dependency is not uninstalled while another installed package still requires it;
- disabling or uninstalling blocks the future, not the past; audit history remains.

See `docs/rfcs/002-package-store-and-skills.md`.

## Session lifecycle

States:

- active;
- archived;
- deleted.

Transitions:

- (created when a member starts a conversation with an agent) → active;
- active → archived (kept, not surfaced by default; resumable);
- active/archived → deleted (the owner deletes the conversation).

Rules:

- a Session is private to its owner by default; read is policy-scoped;
- deleting a Session removes its transcript but does not delete MemoryItems already
  promoted from it, nor audit facts — deletion blocks the future, not the past;
- a transcript is never the audit log; no message content is copied into audit
  events (audit minimality, invariant 16);
- retention defaults to "keep until the owner deletes"; a Sphere may set a retention
  policy, and retention choices are audited as security facts.

See `docs/rfcs/005-agent-chat-sessions-and-conversation-history.md`.
