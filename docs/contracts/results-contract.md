# KinOS — Results Contract v0.2

## Purpose

This contract defines the observable results KinOS must deliver. It describes what must be true from a product perspective, independently from implementation details.

KinOS must allow a human collective to operate a private, durable and governed AI space where each member can have a personal agent, private memory, shared memory, authorized capabilities and a collective Sphere agent.

The first target use case is the family. The architecture must not be limited to families.

## Required results

### 1. Installation

A user can launch a local instance with documented commands. The application is reachable locally, the database is initialized, a local model runtime can be connected, a first administrator account can be created, a first Sphere can be initialized, and no external service is mandatory for the core product.

### 2. Sphere creation

An administrator can create a Sphere in less than five minutes. A Sphere has a name, type, administrators, members, shared memory, policies, capabilities and integrations.

Minimum Sphere types: person, family, team, organization.

### 3. Members

Each member has an identity and one or more roles across Spheres. Roles can differ between Spheres. Membership changes must not destroy memory ownership.

Minimum family roles: parent, teenager, child, guest.

### 4. Personal agents

Each member may have a persistent personal agent. The agent remembers authorized information, distinguishes private from shared memory, uses only authorized capabilities, survives model changes, can be disabled without deleting memory, and can be exported with its configuration.

### 5. Sphere agent

Each Sphere may have a collective agent. It answers only from information available to the Sphere, never receives private memories without authorization, coordinates actions between members, creates shared notes/lists/projects/events, and requests approval before sensitive actions.

### 6. Memory

Memory is structured, durable and governed. Each memory item has an owner, visibility scope, sensitivity classification, lifecycle state and audit trail. It can be edited, deleted, exported and reclassified. Private memory is never injected into model context without authorization.

Minimum visibility scopes: private, selected members, supervisors/parents where applicable, Sphere-shared, public/exportable.

### 7. Consent

Sharing is explicit. The system asks confirmation before sharing private data. The owner can revoke sharing. Revocation blocks future access. Past access remains visible through audit events. Ambiguity never counts as consent.

### 8. Minors

Child and teenager profiles are priority safety cases. Child profiles are highly restricted by default. Teen profiles are more autonomous but supervisable. Dangerous tools, unrestricted browsing and external actions are disabled by default unless explicitly authorized.

### 9. Governance

Authorized administrators can define readable rules. Rules are translated into executable policies, previewed before activation, testable, versioned and auditable.

### 10. Capabilities

Agents request abstract capabilities, not raw APIs. Each capability has an access policy, risk level, input schema, output schema and implementation bindings. Each call is validated before execution.

Example: `calendar.create_event` may be implemented through Google Calendar, CalDAV, Outlook, n8n or a local provider.

### 11. Runtime

KinOS uses an agent runtime for conversations, planning, tool calling and integrations. The runtime is replaceable and owns no business logic. The reference MVP runtime may be Hermes, but KinOS must remain conceptually independent from Hermes.

### 12. Integrations

Integrations are external adapters. They can be added, disabled, revoked and replaced without changing the domain model. Secrets are stored separately. Scopes are visible. Usage is logged. n8n may execute workflows, but it must never be the permission engine.

### 13. Security

Security is applied before the model and before the runtime. Memory is filtered before prompt construction. Capabilities are filtered before planning. Tool requests are validated before execution. Outputs are validated before delivery where needed.

### 14. Audit

Important actions are traceable: requester, agent, rule, capability, tool, accessed data class, decision and reason. Private conversations are not exposed by default. Audit records security facts, not unnecessary intimacy.

### 15. Local-first

Core functions remain available without Internet: local chat, local memory, local search, local rules, local agents and local export. Cloud services are optional extensions.

### 16. Models

The system is model-independent. Local models are supported by default. Remote models require explicit consent. Model usage is logged. Cloud models can be disabled entirely.

### 17. Portability

A Sphere can be exported and restored. Export includes profiles, memory, policies, knowledge, documents, settings and capability bindings where possible. Formats must be documented.

### 18. User experience

The main UI hides technical complexity. Users see Spheres, members, agents, memories, rules, tools and approvals, not embeddings, vector stores, MCP internals or runtime implementation details.

### 19. MVP validation

The MVP is valid when:

- a Sphere can be created;
- two adults and one child can be added;
- each member can have an agent;
- the child cannot access private adult memory;
- memory can be shared and revoked;
- a capability can be allowed for an adult and denied to a child;
- a sensitive action can trigger approval;
- the system runs with a local model runtime;
- data can be exported.

### 20. Long-term scope

The family is the first use case. The core engine must support any governed human collective. KinOS is not a chatbot; it is a governance infrastructure for personal and collective agents.
