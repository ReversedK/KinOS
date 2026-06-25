# KinOS — MVP Implementation Progress

Tracks the autonomous MVP implementation loop (`docs/implementation/mvp-loop.md`).
Goal: reach the MVP validation criteria of `docs/contracts/results-contract.md`
§19 without violating the invariants or coding principles.

## Current state

Domain core + first adapter in Docker. Done: Identity/Sphere/Member (§19 #1,#2),
Policy Engine (ADR-003), Memory + policy-scoped Resolver (§19
child-can't-read-private, share/revoke), Agent (§19 agent-per-member), Approval
flow (ADR-004; §19 approval), Ollama runtime adapter (§19 local model runtime —
live-verified against the host Ollama). Eight of nine §19 criteria hold.
Remaining: export (§19 #9). Then a thin API/CLI surface to make all nine
demonstrable end-to-end as a single runnable flow.

## Stack decisions (ADR-006)

- Language/runtime: **TypeScript on Node.js**; pure domain core, no provider/IO imports.
- Local model runtime (§19): **Ollama** behind a runtime adapter.
- Persistence: **SQLite** behind repository ports; embeddings derived/regenerable.
- First surface: **domain API + thin CLI**; Next.js UI deferred.
- Layout: npm-workspaces monorepo — `packages/core`, `packages/adapters/*`,
  `packages/app/*`, `ui/`. Test runner: Vitest. `tsc --strict`.
- Environment: **Docker only** — no host node/npm. Run via
  `docker compose run --rm dev npm <cmd>`.

## Dependency order being followed

Identity/Sphere/Member → Policy Engine → Memory → Capabilities/Bindings →
Runtime adapter → integrations/Packages → UI.

## §19 MVP criteria checklist

- [x] a Sphere can be created *(core; CLI/API surface pending)*
- [x] two adults and one child can be added *(core; CLI/API surface pending)*
- [x] each member can have an agent *(core; CLI/API wiring pending)*
- [x] the child cannot access private adult memory *(resolver+engine; CLI/API wiring pending)*
- [x] memory can be shared and revoked *(core; CLI/API wiring pending)*
- [x] a capability can be allowed for an adult and denied to a child *(policy engine; CLI/API wiring pending)*
- [x] a sensitive action can trigger approval *(core; CLI/API wiring pending)*
- [x] the system runs with a local model runtime *(Ollama adapter; live listModels passed against the running host Ollama)*
- [ ] data can be exported

## Log

### Iteration 1 — 2026-06-25
- **Done:** Wrote and accepted `docs/adr/006-implementation-stack.md` (TS/Node,
  Ollama, SQLite, API/CLI-first, npm-workspaces monorepo, Vitest, strict TS).
  Confirmed the four open stack decisions with the human before writing.
- **Decisions:** see Stack decisions above.
- **Next step:** Scaffold the monorepo (root `package.json` workspaces, `tsconfig`
  base, Vitest config, empty `packages/core`) and prove the toolchain with one
  trivial failing→passing test. Then begin the first domain slice: Identity /
  Sphere / Member value objects + creation, TDD, with a failing test encoding
  "a Sphere can be created" and "two adults and one child can be added".

### Iteration 2 — 2026-06-25
- **Done:** Scaffolded npm-workspaces monorepo (root `package.json`,
  `tsconfig.base.json` strict, root `tsconfig.json` project refs, `vitest.config.ts`,
  `packages/core`). Proved the toolchain with a red→green test
  (`CORE_CONTRACT_VERSION`). Pivoted the toolchain to **Docker** per human
  instruction: added `Dockerfile`, `docker-compose.yml`, `.gitignore`; removed host
  `node_modules`. All commands now run via `docker compose run --rm dev …`.
- **Verified (in container):** `npm test` → 1 passed; `npm run typecheck` → exit 0.
- **Decisions:** Docker is the dev/run environment (ADR-006 "Dev and run
  environment"); Node stays the runtime.
- **Next step:** First domain slice — Identity / Sphere / Member. TDD: failing
  test encoding §19 "a Sphere can be created" and "two adults + one child added",
  modelling roles (parent/child) per results-contract §3 and domain-model.md.
  Pure `packages/core`, no I/O.

### Iteration 3 — 2026-06-25
- **Done:** First domain slice in `packages/core`. `identity/` (Identity +
  createIdentity), `sphere/member.ts` (Role parent/teenager/child/guest,
  MemberStatus, isMinor → child/teenager per §8), `sphere/sphere.ts` (SphereType,
  SphereStatus, createSphere [founder = first member + administrator, active],
  addMember [immutable, deny duplicate], listMembers). All pure, ids
  caller-supplied (no crypto import). Red→green TDD.
- **Verified (in container):** `npm test` → 8 passed (3 files); `typecheck` → exit 0.
- **Decisions:** createSphere yields `active` (entity-lifecycle draft→active
  "initialized and ready"); minors = child+teenager; ids injected to keep core
  deterministic and I/O-free.
- **Next step:** Policy Engine slice (ADR-003 / domain-model Policy). TDD a
  minimal evaluator honouring: deny strictly dominates require_approval dominates
  allow; absence of an allow = deny (deny by default). This is the gate the
  §19 minor/private-memory and adult-vs-child capability criteria depend on.

### Iteration 4 — 2026-06-25
- **Done:** Policy Engine in `packages/core/policy/`. `types.ts` (PolicyRequest,
  PolicyDecision, Policy, effects — verbatim from ADR-003) and `engine.ts`
  `evaluate(request, policies)`: staged eval with fixed precedence
  deny > require_approval > allow, deny-by-default, unresolved subject → deny,
  active-only policy selection, conflict resolution by priority then specificity
  (names the cited policy, never changes the effect). Matching: roles,
  ageProfiles, memberIds; capability exact + `prefix.*`; classifications
  (unclassified → private), sensitivities, riskLevels; context execution +
  time windows. 13 tests cover ADR worked examples 1/2/4/5.
- **Verified (in container):** `npm test` → 21 passed (4 files); `typecheck` → exit 0.
- **Decisions/limits:** `subjectSelector.agents` (personal/sphere) and
  `contextConditions.maxCostCents` deferred — a specific agent-kind selector
  conservatively does not match yet; no §19 criterion needs either. Time windows
  use the ISO timestamp's wall-clock (no TZ database) — faithful for local HH:MM.
- **Next step:** Memory slice — MemoryItem (owner, visibility, sensitivity,
  share grants, lifecycle) per domain-model + ADR-002. TDD createMemoryItem,
  share/revoke (revocation keeps the grant as an audit fact). Then a Memory
  Resolver that asks the Policy Engine, making §19 "child can't read adult
  private memory" and "share then revoke" demonstrable.

### Iteration 5 — 2026-06-25
- **Done:** Memory slice in `packages/core/memory/`. `memory.ts`: MemoryItem
  (ADR-002 shape), createMemoryItem (private+active+normal by default),
  shareWithMembers (grants + widen, owner unchanged), revokeShare (sets
  revokedAt, retains grant as audit fact, item stays active), hasActiveGrant —
  all immutable. `resolver.ts`: authorizeMemoryRead / resolveReadableMemory —
  computes structural visibility (owner/scope/active-grant, active-only) and
  expresses it as a lowest-priority synthetic allow run through the Policy
  Engine, so real deny/approval (e.g. medical) still dominate and no structural
  visibility = deny-by-default. 9 tests incl. ADR example 3.
- **Verified (in container):** `npm test` → 30 passed (6 files); `typecheck` → exit 0.
- **Decisions:** Resolver stays a *consumer* of the engine (no duplicated
  precedence) by injecting a synthetic structural-allow. shared_with_sphere =
  visible to any sphere member/agent for MVP; sphere-share revocation nuance and
  embeddings deferred (embeddings are derived/regenerable, not modelled).
- **Next step:** Agent slice (domain-model Agent; entity-lifecycle Agent) —
  Agent(owner=member|sphere), enabled capabilities, memory-access profile,
  configured/active/disabled, "disabling does not delete memory". TDD. Gives
  §19 "each member can have an agent". Then approval flow (ADR-004) for §19
  "sensitive action triggers approval".

### Iteration 6 — 2026-06-25
- **Done:** Agent slice in `packages/core/agent/agent.ts`. Agent (owner
  member|sphere, distinct identity, enabledCapabilities, modelPreference,
  state). createAgent (configured; rejects id==ownerId; rejects empty name),
  enable/disableCapability, activate/pause/disableAgent, changeModelPreference
  (same identity — boring swap). All immutable. 6 tests, incl. an integration
  test proving disabling an agent leaves its owner's memory readable.
- **Verified (in container):** `npm test` → 36 passed (7 files); `typecheck` → exit 0.
- **Decisions:** modelPreference is an advisory tag (Ollama model name later);
  agent's acting role/ageProfile (for capability execution as owner) deferred to
  the capability-execution slice. Sphere-agent persona (ADR-005 layer 2) deferred.
- **Next step:** Approval flow (ADR-004 / entity-lifecycle ApprovalRequest) for
  §19 "a sensitive action can trigger approval". TDD: a require_approval policy
  decision creates a pending ApprovalRequest; grant/deny/expire transitions;
  granted is single-use; requester/agent cannot self-approve. Threads the
  correlation id.

### Iteration 7 — 2026-06-25
- **Done:** Approval flow in `packages/core/approval/approval.ts`.
  ApprovalRequest (ADR-004 shape). createApprovalFromDecision (only from a
  require_approval decision; carries correlationId + deciding policy; computes
  expiresAt). recordApprovalDecision (eligibility: active member holding an
  approver role, not the requester, not a minor; deny dominates; quorum distinct
  grants; duplicates ignored; resolved requests rejected). expireIfDue
  (expiry = denial), cancelApproval, isAuthorized (granted only). All immutable.
  13 tests cover every ADR-004 acceptance criterion.
- **Verified (in container):** `npm test` → 49 passed (8 files); `typecheck` → exit 0.
- **Decisions:** minors are categorically ineligible to approve (satisfies "a
  minor can never approve an action by or about themselves"); approver
  eligibility facts are passed in (core does no Sphere lookup, stays pure);
  timeout/risk escalation beyond quorum deferred (no §19 dependency).
- **Next step:** Local model runtime adapter (Ollama) — define the runtime port
  in core (e.g. AgentRuntime/CapabilityExecutor interface) and an Ollama adapter
  in packages/adapters/runtime-ollama. Port lives in core (pure); adapter
  imports the provider. Gives §19 "runs with a local model runtime". TDD the
  port contract with a fake; integration-test the adapter behind a flag (no live
  Ollama in CI). Confirm doc coverage (ADR-001 + ADR-006) before coding.
  - **Human directive (2026-06-25): use the existing/running Ollama**, not a
    containerised one. Verified: host Ollama API is up at :11434 and reachable
    from the dev container via `host.docker.internal:11434` (no models pulled
    yet → generation tests skip; connectivity/list test can run). Wired
    `OLLAMA_BASE_URL=http://host.docker.internal:11434` + host-gateway mapping
    into docker-compose. Adapter must read `OLLAMA_BASE_URL` (default
    `http://localhost:11434`).

### Iteration 8 — 2026-06-25
- **Done:** Runtime port + Ollama adapter. `packages/core/runtime/runtime.ts`:
  AgentRuntime port (listModels/generate/isAvailable; RuntimeMessage/Request/
  Response) — pure interface, runtime decides no permissions (ADR-001).
  `packages/adapters/runtime-ollama` (first provider-bearing package, @kinos/core
  dep): OllamaRuntime over /api/tags + /api/chat (stream:false), reads
  OLLAMA_BASE_URL (default localhost:11434), injectable fetch. 4 mocked-fetch
  unit tests + a live test gated on reachability. Monorepo wiring: adapter
  tsconfig resolves @kinos/core via paths + project reference; added @types/node;
  root tsconfig references the adapter.
- **Verified (in container):** `npm test` → 54 passed, 1 skipped (live
  generation — no model pulled); the live `listModels` test **passed against the
  running host Ollama**. `typecheck` → exit 0 across both packages.
- **Decisions:** adapter connects to an existing Ollama (never starts one);
  generation test skips until a model is pulled (e.g. `ollama pull llama3.2` on
  the Ollama host). Tool-calling/streaming and Hermes runtime deferred (no §19
  dependency).
- **Next step:** Export slice (§19 #9 / results-contract §17, ADR-002 export).
  TDD an exportSphere(sphere, members, agents, memory, policies) → documented
  JSON snapshot (canonical items, ownership, visibility, sensitivity, lifecycle;
  not embeddings) + importSphere round-trip. Pure core. Then a thin CLI/API in
  packages/app to drive the full §19 sequence end-to-end.
