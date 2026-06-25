# KinOS — Glossary

Core terms, one paragraph each, consistent with `domain/domain-model.md` and the contracts. Entries are alphabetical.

## Adapter

A replaceable implementation that connects KinOS to an external or local system. Adapters implement capabilities; they never define permissions, own memory, or decide consent. See Integration.

## Agent

A digital representative acting for a person or Sphere within authorized boundaries. An agent requests capabilities, never raw tools, and represents its owner without claiming to be them.

## Approval Request

A human validation required before a sensitive action proceeds. It records requester, agent, Sphere, capability, payload, risk, approvers, decision and expiry. Until approved, the action is blocked; ambiguity or timeout is not consent.

## Audit Event

A minimal security-relevant fact recorded for traceability: actor, agent, Sphere, event type, resource class, decision, reason, timestamp and correlation id. It records security facts, not private conversation content.

## Capability

A governed abstract action that an agent can request, such as `memory.search` or `calendar.create_event`. Capabilities are the internal API of KinOS; each declares risk level, allowed subjects, input/output schema, approval and audit requirements.

## Capability Binding

The per-Sphere mapping between a KinOS capability and one concrete runtime tool, workflow or integration operation. It declares scopes, a secret reference and whether it performs an external transfer. It answers "how" a capability runs, never "whether" it is allowed.

## Consent

An explicit authorization given by the owner or authorized subject for a defined action, sharing scope or external transfer. Silence and ambiguity never count as consent; consent is revocable.

## Correlation Id

The identifier that chains one sensitive action across its whole path: policy check, approval, runtime call and integration call, plus the resulting audit events. It makes a decision explainable end to end.

## Integration

An adapter to an external or local system that implements one or more capabilities. It has a provider, credentials reference, scopes, status, capability bindings and audit settings, and can be enabled or disabled per Sphere.

## Member

A human or Sphere participating in a Sphere. A member has an identity, one or more Sphere-scoped roles, a profile and a status. Membership changes never erase memory ownership.

## Memory Item

A durable, structured, owned and governed unit of memory. Each item has an owner, Sphere, content, summary, visibility scope, sensitivity, lifecycle state, source and audit references. Canonical memory is the record; embeddings are derived from it.

## Minor

A child or teenager profile, treated as a priority safety case. Minors are restricted by default: dangerous tools, unrestricted browsing and external actions are disabled unless explicitly authorized. Supervision is bounded, not total surveillance.

## Model

A language model used by a runtime. It is replaceable and owns neither memory nor policy. Changing the model must require no memory migration and no policy change.

## Policy

A rule evaluated by KinOS to allow, deny or require approval for an action. A policy has a Sphere, subject selector, action, resource selector, context conditions, effect, version and status, and is auditable and testable.

## Policy Engine

The KinOS component that evaluates policies before memory retrieval, capability execution and runtime use. It is the authorization boundary; prompts and integrations are not. It runs before the runtime and decides "if"; the runtime only executes.

## Revocation

The withdrawal of a previously granted authorization or sharing. Revocation immediately blocks future access but does not delete canonical memory, and past access remains visible as audit facts.

## Runtime

The technical system that runs agent sessions, model calls and tool execution. It is replaceable and owns no business logic. Hermes is the reference MVP runtime; it executes but never decides permissions, memory sharing, approvals or confidentiality.

## Sensitivity

The classification of how protected a memory item or action is (for example normal, personal, sensitive, critical). Higher sensitivity raises the bar for visibility, sharing, external transfer and approval.

## Sphere

A governed unit of human representation. A Sphere can represent a person, family, couple, team, company, school, association or institution, and may be a member of another Sphere, forming a governed graph. Each Sphere owns or controls identity, members, agents, memory, policies, capabilities, integrations and audit boundaries.

## Sphere Agent

An agent representing a Sphere rather than an individual person. It answers only from information available to the Sphere, never receives private memories without authorization, and requests approval before sensitive actions.

## Supervisor

A Member whose Sphere role carries supervisory responsibility over another member, such as a parent or guardian over a minor or an administrator over the Sphere. Supervisor status is resolved per Sphere from role, is not a global identity, and does not by itself grant access to another member's private content (supervision is not surveillance).

## Visibility Scope

The set of subjects allowed to see a memory item: private, selected members, supervisors/parents where applicable, Sphere-shared, or public/exportable. New data is private by default; widening the scope requires explicit consent.
