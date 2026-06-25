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
- [ADR-005 — Sphere Agent: Shared Space and Optional Collective Actor](docs/adr/005-sphere-agent-shared-space-and-actor.md)

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

## Running the MVP

The toolchain runs in Docker (no host node/npm; see ADR-006). A TypeScript
monorepo holds the provider-independent domain core (`packages/core`), adapters
(`packages/adapters/*`) and apps (`packages/app/*`).

```bash
docker compose run --rm dev npm install        # one-time
docker compose run --rm dev npm test           # unit + acceptance tests
docker compose run --rm dev npm run typecheck   # strict tsc across packages
```

Run the results-contract §19 acceptance scenario end-to-end (creates a Sphere,
adds two adults + a child, an agent per member, checks private-memory denial,
share/revoke, an adult-vs-child capability, a sensitive-action approval, the
local model runtime, and export):

```bash
docker compose run --rm dev npm run mvp -w @kinos/cli
```

The local model runtime is an existing/running **Ollama**, reached via
`OLLAMA_BASE_URL` (compose points the dev container at the host's Ollama). The
acceptance run reports the runtime as reachable; pull a model (e.g.
`ollama pull llama3.2`) on the Ollama host to also exercise generation.

Implementation progress is tracked in [`PROGRESS.md`](PROGRESS.md).

## Development rule

No substantial implementation should be added before the corresponding domain or architecture document exists and has been accepted.
