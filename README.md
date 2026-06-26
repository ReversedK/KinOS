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
acceptance run reports the runtime as reachable. To also exercise live
generation, pull a chat model on the Ollama host (e.g. `ollama pull qwen2.5:7b`);
the live runtime test then picks the first non-embedding model, or whatever
`OLLAMA_TEST_MODEL` names.

### Persisting Spheres (local-first, SQLite)

State persists to a SQLite database at `$KINOS_DB` (default `./data/kinos.sqlite`):

```bash
docker compose run --rm dev npm run cli -w @kinos/cli -- init sph_1 "Doe Family"
docker compose run --rm dev npm run cli -w @kinos/cli -- list
docker compose run --rm dev npm run cli -w @kinos/cli -- show sph_1
docker compose run --rm dev npm run cli -w @kinos/cli -- export sph_1   # snapshot JSON
```

A Sphere created in one run is read back by later runs — the database is
initialized on first use and no external service is required (results-contract
§1, §15).

`init` prints a `correlationId`; the audit trail (security facts only, no
content) persists to `$KINOS_AUDIT_DB` (default `./data/audit.sqlite`) and is
viewable across runs:

```bash
docker compose run --rm dev npm run cli -w @kinos/cli -- audit <correlationId>
```

Run a capability through the governed pipeline (catalog profile floor → enabled
binding → Policy Engine → approval floor → execute), recording an audit chain:

```bash
docker compose run --rm dev npm run cli -w @kinos/cli -- run sph_1 calendar.create_event adult
docker compose run --rm dev npm run cli -w @kinos/cli -- run sph_1 payment.execute child
```

A freshly `init`ed Sphere has no bindings, so `run` is denied by default; a
Sphere whose snapshot carries an enabled binding and an allowing policy
executes. Either way the action's outcome and `correlationId` are printed and
the audit chain is queryable with `audit`.

When a capability needs approval (a policy or a catalog approval floor), `run`
prints `outcome: pending_approval` with an `approvalId` and persists it. A human
resolves it — even in a later process — and the action resumes on grant:

```bash
docker compose run --rm dev npm run cli -w @kinos/cli -- approve <approvalId> grant
docker compose run --rm dev npm run cli -w @kinos/cli -- approve <approvalId> deny
```

The whole sequence shares one correlation id, so `audit <correlationId>` shows
`capability.requested → approval.requested → approval.granted → capability.allowed
→ capability.executed`. Pending approvals persist to `$KINOS_APPROVALS_DB`
(default `./data/approvals.sqlite`).

### Read API (HTTP)

A read-only HTTP API exposes already-governed state for clients/UI. It reads the
same SQLite databases as the CLI and listens on `$KINOS_API_PORT` (default 8787):

```bash
docker compose run --rm -p 8787:8787 dev npm run serve -w @kinos/api
# then: GET /health, /spheres, /spheres/:id, /approvals, /audit/:correlationId
```

Every response includes an `x-correlation-id` header; errors use the
api-contract codes (`not_found`, `invalid_request`) and never leak content.

### UI (Next.js)

A read-only Next.js UI (`ui/`) lists Spheres and (soon) members/agents/approvals
from the read API, hiding all technical internals (results-contract §18). It
reads `KINOS_API_URL` (default `http://localhost:8787`).

Seed a demo Sphere (2 adults + 1 child, an agent per member) and run the API +
UI together in one container (the UI server-renders by calling the API, so they
share a container; absolute DB paths keep every process on the same database):

```bash
# 1. seed the §19 demo Sphere
docker compose run --rm -e KINOS_DB=/app/data/kinos.sqlite dev \
  npm run cli -w @kinos/cli -- seed-demo sph_demo "Demo Family"

# 2. build, then serve API (:8787) + UI (:3000)
docker compose run --rm dev npm run build -w @kinos/ui
docker compose run --rm -p 3000:3000 -p 8787:8787 \
  -e KINOS_DB=/app/data/kinos.sqlite \
  -e KINOS_AUDIT_DB=/app/data/audit.sqlite \
  -e KINOS_APPROVALS_DB=/app/data/approvals.sqlite \
  -e KINOS_API_URL=http://localhost:8787 \
  dev sh -lc '(cd packages/app/api && npx tsx src/main.ts &) ; cd ui && npx next start -p 3000'
```

Then open <http://localhost:3000>: the Spheres list → a Sphere's members and
agents → pending approvals. For iterative work, replace `next start` with
`npm run dev -w @kinos/ui`.

Implementation progress is tracked in [`PROGRESS.md`](PROGRESS.md).

## Development rule

No substantial implementation should be added before the corresponding domain or architecture document exists and has been accepted.
