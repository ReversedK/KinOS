# KinOS — Domain Model

## Purpose

This document defines the minimum domain vocabulary required for development. It is not a database schema. It defines the business objects and their relationships.

These objects are provider-agnostic. None of them may carry a Hermes tool name, MCP server name, n8n workflow id or third-party API as a domain concept; those live in adapters and bindings. The domain manipulates capabilities, not tools.

## Core entities

### Sphere

A governed unit of human representation.

Fields/concepts:

- id;
- type;
- name;
- administrators;
- members;
- policies;
- capabilities;
- memory;
- integrations.

### Member

A human or Sphere participating in another Sphere.

Fields/concepts:

- id;
- identity;
- Sphere membership;
- role;
- profile;
- status.

### Agent

A digital representative of a person or Sphere.

Fields/concepts:

- id;
- owner;
- scope;
- runtime configuration;
- model preference;
- enabled capabilities;
- memory access profile.

### MemoryItem

A durable, governed unit of memory. Canonical; embeddings are derived and regenerable.

Fields/concepts:

- id;
- owner (member or Sphere) — sharing never transfers ownership;
- Sphere;
- content;
- summary;
- visibility (private, shared_with_members, shared_with_supervisors, shared_with_sphere, public_exportable);
- share grants (subject, granted by/at, revoked at) — revocation keeps the grant as an audit fact;
- sensitivity (normal, sensitive, medical, financial, legal);
- lifecycle state;
- source (manual, conversation, import, integration);
- audit references.

Private by default. Scope is widened only by an explicit, consented share. See `docs/adr/002-memory-architecture.md`.

### Policy

A rule evaluated by the Policy Engine.

Fields/concepts:

- id;
- Sphere;
- description (human-readable source rule);
- subject selector (roles, age profiles, member ids, agent kind);
- action (read, write, share, revoke, execute, approve, export, enable, disable);
- resource selector (types, capability names, classifications, sensitivities, risk levels);
- context conditions (time windows, local/cloud, cost ceiling);
- effect (allow, deny, require_approval);
- approver roles (when effect is require_approval);
- priority;
- version;
- status (draft, test, active, disabled, superseded, archived).

An empty selector field matches any value. Deny strictly dominates require_approval, which strictly dominates allow. Absence of an allow is a denial. See `docs/adr/003-policy-engine.md`.

### Capability

An abstract action agents can request. Capabilities are the internal API; agents never request raw tools, MCP servers, workflows or provider APIs.

Fields/concepts:

- name (lowercase-dotted, e.g. `calendar.create_event`);
- description;
- risk level (low, medium, high, critical);
- input schema;
- output schema;
- policy requirements;
- implementation bindings.

### Capability Binding

The mapping between one Capability and one concrete runtime/adapter operation. A Capability may have several bindings (e.g. local and cloud); selection is policy- and Sphere-configured, local-first by default.

Fields/concepts:

- capability;
- runtime/adapter target (provider-specific name kept out of the domain);
- execution (local or cloud);
- risk;
- approval floor;
- status (proposed, enabled, disabled, deprecated, removed).

A binding implements a capability; it never defines permissions. Disabling a binding blocks future execution; audit history remains. See `docs/adr/001-runtime-and-integration-architecture.md`.

### Integration

An external or local adapter implementing capabilities.

Fields/concepts:

- provider;
- credentials reference;
- scopes;
- status;
- capability bindings;
- audit settings.

### ApprovalRequest

A human validation request required before an action.

Fields/concepts:

- requester;
- agent;
- Sphere;
- capability;
- payload;
- risk;
- approvers;
- decision;
- expiry.

### AuditEvent

A minimal record of a security-relevant event.

Fields/concepts:

- actor;
- agent;
- Sphere;
- event type;
- resource class;
- decision;
- reason;
- timestamp;
- correlation id.

## Relationship summary

- A Sphere has many Members.
- A Sphere has many Agents.
- A Sphere has many Policies.
- A Sphere has many Capability Bindings.
- Spheres can be members of other Spheres (a governed graph, not only a tree).
- A Member can own one or more Agents.
- An Agent represents exactly one owner (a Member or a Sphere) and never claims to be that owner.
- A MemoryItem has one owner and may be shared with many subjects; sharing does not change the owner.
- A Capability is implemented by one or more Capability Bindings.
- An Integration provides one or more Capability Bindings.
- A Policy controls access to MemoryItems, Capabilities, Integrations and Sphere resources.
- An ApprovalRequest is raised when a Policy returns require_approval; it links subject, capability and approvers via a correlation id.
- An AuditEvent records a security-relevant decision and carries the correlation id chaining policy check, approval, runtime call and integration call.

## Identifiers and correlation

- Every collective-owned entity references a Sphere.
- Roles are scoped to a Sphere; the same Member may hold different roles in different Spheres.
- Agent identity is distinct from Sphere identity and from Member identity.
- Every sensitive action carries a correlation id that threads policy check → approval → runtime call → integration call → audit events.
