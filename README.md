# KinOS

KinOS is a local-first infrastructure for personal and collective AI agents living inside human Spheres.

The first use case is the family, but the core abstraction is broader: a Sphere can represent a person, family, team, organization, school, association or institution.

KinOS is not a family chatbot. It is an infrastructure of trust for agents operating inside real human collectives.

## Core principle

Models can change. Tools can change. Integrations can change. Interfaces can change.

Data sovereignty, privacy, consent, portability, memory ownership and safety must not change.

## Documentation

### Foundation

- [Manifesto](docs/manifesto.md)
- [Results Contract](docs/contracts/results-contract.md)
- [Invariants Contract](docs/contracts/invariants-contract.md)
- [Glossary](docs/glossary.md)

### ADR

- [ADR-000 — Sphere Model](docs/adr/000-sphere-model.md)
- [ADR-001 — Runtime and Integration Architecture](docs/adr/001-runtime-and-integration-architecture.md)
- [ADR-002 — Memory Architecture](docs/adr/002-memory-architecture.md)
- [ADR-003 — Policy Engine](docs/adr/003-policy-engine.md)
- [ADR-004 — Approval and Escalation Model](docs/adr/004-approval-and-escalation-model.md)

### Domain

- [Domain Model](docs/domain/domain-model.md)
- [Capability Catalog](docs/domain/capability-catalog.md)
- [Entity Lifecycle](docs/domain/entity-lifecycle.md)

### Architecture

- [Coding Principles](docs/architecture/coding-principles.md)
- [Event Model](docs/architecture/event-model.md)
- [API Contract](docs/architecture/api-contract.md)
- [Integration Model](docs/architecture/integration-model.md)
- [Secret Store](docs/architecture/secret-store.md)
- [Plugin SDK](docs/architecture/plugin-sdk.md)

### Security

- [Trust Model](docs/security/trust-model.md)
- [Privacy Model](docs/security/privacy-model.md)
- [Threat Model](docs/security/threat-model.md)

### RFC

- [RFC Template](docs/rfcs/000-template.md)
- [RFC-001 — Sphere-first Architecture](docs/rfcs/001-sphere-first-architecture.md)
- [RFC-002 — Package Store and Skills](docs/rfcs/002-package-store-and-skills.md)

## Development rule

No substantial implementation should be added before the corresponding domain or architecture document exists and has been accepted.
