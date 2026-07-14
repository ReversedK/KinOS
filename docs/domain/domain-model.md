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
- integrations;
- runtime profile (selected inference provider + model; cloud inference disableable — see RuntimeProfile);
- installed packages;
- runtime gateway (the per-Sphere governed capability gateway exposed to agent runtimes, policy-scoped per calling agent — realized as the Sphere MCP; see `docs/architecture/integration-model.md`);
- agent runtime configuration projections (per-agent governed runtime config derived from Sphere config — see RuntimeConfigProjection).

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
- model preference (a governed selection *within* the Sphere's allowed providers/models; never a provider the Sphere has disabled — see RuntimeProfile, RFC-004);
- enabled capabilities;
- memory access profile;
- runtime configuration projection (the governed runtime config derived from the Sphere's config and this agent's policy scope — see RuntimeConfigProjection, RFC-007);
- harness (the governed execution environment the agent runs inside; MVP: Hermes — see Harness, ADR-008);
- runtime state snapshot (opaque, restorable runtime working state; non-canonical — see RuntimeStateSnapshot).

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

### Harness

The governed execution environment an Agent **always** runs inside — an Agent never
executes "bare". A Harness holds **no ambient authority**: it runs *downstream* of
the Policy Engine on an already-governed RuntimeConfigProjection, and reaches every
capability **only** through the Sphere MCP runtime gateway, where each call is
policy-checked per call and anchored to the agent's scoped credential. It is
**distinct from the inference runtime** — the `AgentRuntime` port / RuntimeProfile
that merely generates text: a Harness *uses* an inference backend and runs the agent
on exactly the governed model projected into it. A first-class, **replaceable** role,
not a product: the domain depends on the Harness contract (projection + Sphere MCP +
scoped credential), never on a specific harness, and swapping one is "boring" (no
policy/memory/capability/credential migration). **Hermes is the sole MVP Harness**, an
adapter behind the role. The Harness is **never the authorization or privacy
boundary** — its profile/prompt is a projection of decisions already made, and it is
a second line of defence, not the first. See
`docs/adr/008-agents-always-run-in-a-governed-harness.md`.

### RuntimeProfile

The Sphere's selected inference provider and model — the text backend a Harness runs
on, not the execution environment itself (see Harness). Configuration, not a model
dependency: the domain references the `AgentRuntime` port, never a provider SDK.
See `docs/rfcs/004-inference-provider-and-model-configuration.md`.

Fields/concepts:

- provider id (MVP: `ollama` local, `openai` cloud);
- model;
- base url (optional; self-hosted / OpenAI-compatible endpoints);
- secret reference (cloud credentials, by reference only — never the key);
- execution class (local or cloud);
- cloud-inference enabled flag (Sphere-level; default off, disableable entirely).

Local-first by default. Selecting or using a cloud provider is a high-risk,
admin-only, approval-gated action, denied for minors by default, and audited as an
external transfer. An Agent's model preference is constrained to what the Sphere
allows. Changing provider or model is "boring": no memory migration, no policy
change.

### RuntimeConfigProjection

The governed, per-agent runtime configuration KinOS derives from Sphere config and
the agent's policy scope, then writes to the agent's Harness (the execution
environment it runs in — see Harness). The domain owns the projection; the Harness
never edits its own governance config. Provider-agnostic: for the Hermes reference
harness it is realized in the adapter as a
per-agent profile (its config file plus a scoped credential), and that realization
name never enters the domain. See `docs/rfcs/007-hermes-governed-runtime.md`.

Fields/concepts:

- agent;
- Sphere;
- runtime profile (provider/model — see RuntimeProfile);
- runtime gateway reference plus the agent's scoped credential reference (secret-store reference, never the value);
- allowed capability surface (the capabilities the Policy Engine authorizes for this agent — deny by default);
- native-tool allow-list (deny by default);
- autonomous tool/integration install disabled;
- version and audit references.

The runtime gains new capabilities only through the governed package store
(RFC-002); it never installs its own. Reprojection is a governed, audited action
(`runtime.config.project`).

### RuntimeStateSnapshot

An opaque, restorable backup of an agent's runtime working state (the runtime's
own sessions, working memory, skills and state). **Non-canonical**: distinct from
canonical MemoryItems and from KinOS Sessions — the runtime's internal working
memory is private runtime state, never canonical Sphere memory. Stored local-first
and encrypted, held by reference; KinOS backs it up and restores it without reading
its content. It provides runtime continuity (crash, restart, migration), not
cross-runtime portability — canonical memory remains the portable record. See
`docs/rfcs/007-hermes-governed-runtime.md`.

Fields/concepts:

- agent;
- Sphere;
- snapshot reference (encrypted blob, by reference — never inline content);
- created at;
- lifecycle / retention state;
- audit references.

Backup and restore are governed, audited actions (`runtime.session.backup`,
`runtime.session.restore`) recording the fact only, never session content.

### Session

A conversation between a member and an agent, holding the running transcript for
continuity. Distinct from canonical MemoryItems and from AuditEvents. See
`docs/rfcs/005-agent-chat-sessions-and-conversation-history.md`.

Fields/concepts:

- id;
- Sphere;
- agent (the agent being talked to);
- owner (the acting member who owns this conversation);
- title;
- messages;
- lifecycle state.

Private to its owner by default; read is policy-scoped. A transcript is short-term
continuity, never the audit log and never canonical memory — promoting a fact to
long-term memory is an explicit, governed action creating a MemoryItem.

### Message

One turn within a Session.

Fields/concepts:

- id;
- session;
- role (conversational only: `user` or `agent` — never an authorization role);
- content (conversational content; private);
- created at;
- correlation id (links to any capability calls made during the turn).

### Package

The unit of distribution installed from the store to extend an agent. See `docs/rfcs/002-package-store-and-skills.md`.

Fields/concepts:

- id;
- type (skill, mcp, bundle);
- title;
- description (plain, practical: what it lets the agent do);
- version;
- publisher and signature;
- verification level;
- age rating;
- dependencies (other packages, version-ranged);
- provided capabilities;
- required capabilities and scopes;
- default policies (presets proposed by the install grant wizard);
- lifecycle state.

A **Skill** is a Package of type `skill` (an agent competence composing capabilities). An **mcp** package is an Integration adapter. Installing a Package makes capabilities available and creates Capability Bindings in a disabled state; it never grants use — only policies confirmed at install authorize anyone, and the Policy Engine still evaluates every call.

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
- A Package is installed into a Sphere; a `skill` package composes Capabilities, an `mcp` package provides an Integration, and a Package may depend on other Packages.
- A Sphere has one RuntimeProfile selecting the inference provider and model; an Agent's model preference is constrained to what that profile allows.
- Each Agent always runs inside a Harness (MVP: Hermes) — a governed execution environment with no ambient authority that reaches capabilities only via the Sphere MCP; the Harness *uses* the inference RuntimeProfile and never decides authorization (ADR-008).
- A Sphere exposes one governed runtime gateway (the Sphere MCP) surfacing policy-scoped capabilities to agent runtimes; each agent's runtime authenticates with its own scoped credential and sees only its authorized capability surface.
- Each Agent has one RuntimeConfigProjection derived from Sphere config and its policy scope; the runtime never edits its own governance config and gains new capabilities only via the package store.
- Each Agent's runtime working state may be captured as a RuntimeStateSnapshot — opaque, encrypted, restorable, non-canonical, and distinct from Sessions and MemoryItems.
- A Member owns many Sessions; a Session belongs to one Agent and one owning Member and contains many Messages; a Session is neither a MemoryItem nor an AuditEvent, and a fact is moved from a Session to canonical memory only by an explicit, governed promotion.
- An ApprovalRequest is raised when a Policy returns require_approval; it links subject, capability and approvers via a correlation id.
- An AuditEvent records a security-relevant decision and carries the correlation id chaining policy check, approval, runtime call and integration call.

## Identifiers and correlation

- Every collective-owned entity references a Sphere.
- Roles are scoped to a Sphere; the same Member may hold different roles in different Spheres.
- Agent identity is distinct from Sphere identity and from Member identity.
- Every sensitive action carries a correlation id that threads policy check → approval → runtime call → integration call → audit events.
