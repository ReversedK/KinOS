# KinOS — Privacy Model

## Purpose

This document defines how KinOS protects privacy across persons, Spheres, agents, memory, audit and integrations.

## Privacy principles

- Private by default.
- Explicit sharing.
- Revocable access.
- Minimal disclosure.
- Local-first operation.
- Model-independent memory.
- Audit without surveillance.

## Privacy scopes

### Private

Visible only to the owner and authorized processes acting for the owner.

### Shared with selected members

Visible only to explicitly selected members or agents representing them.

### Shared with supervisors

Used for family or organizational governance. Must not imply total surveillance.

A **supervisor** is a Member whose Sphere role carries supervisory responsibility over another member — for example a parent or guardian over a minor, or a Sphere administrator over the Sphere. Supervisor status is resolved per Sphere from role (see `docs/adr/000-sphere-model.md`), is not a global identity, and never by itself grants access to another member's private content.

### Shared with Sphere

Visible to the Sphere agent and authorized Sphere members.

### Public/exportable

Marked as suitable for export or publication, subject to final policy evaluation.

## Scope transitions

Privacy is enforced by scope and the Policy Engine together. Scopes describe potential visibility; every access is still policy-checked.

- New data starts `private`.
- Widening a scope requires an explicit, consented action (`memory.share`); silence or ambiguity never widens it.
- Narrowing (revocation) blocks future access immediately; the prior grant remains as an audit fact.
- `public_exportable` does not mean already public: a final policy and external-transfer check still apply before anything leaves the local environment.
- Sensitivity (medical, financial, legal) raises restriction independently of scope; a `private` + `medical` item is denied to supervisors even where a supervisor scope would otherwise apply.

## Minor privacy

Minors need protection and personal space. Supervision is not surveillance. KinOS distinguishes:

- safety alerts;
- audit events;
- private conversations;
- private memories;
- parental approvals.

Parents or supervisors can govern the environment without automatically reading all private conversations.

What supervision **does** allow by default: setting policies, seeing audit facts (decisions, not content), receiving safety escalations, and answering approval requests for restricted actions.

What supervision does **not** allow by default: reading a minor's private conversations or private memory content, or silently widening their scopes. Access to private content is a separate, explicit, audited escalation — not an implicit property of the supervisor role.

## External transfers

Before external transfer, KinOS must know:

- data class;
- destination service;
- purpose;
- capability;
- consent source;
- retention expectation if known.

Each of these is recorded as an external-transfer event (requested → allowed/denied). A transfer without a known data class, destination and consent source is denied. Cloud model use is itself an external transfer and follows this rule.

## Audit privacy

Audit events should record decisions and metadata, not unnecessary content.

Example good audit: `child_agent denied message.send because policy minors_external_messages denied`.

Example bad audit: full private conversation copied into logs.

Audit references private items by id and classification, never by copying their content. Audit and telemetry are separate systems with separate consent rules; product telemetry must never become a back door to private content.
