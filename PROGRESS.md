# KinOS — MVP Implementation Progress

Tracks the autonomous MVP implementation loop (`docs/implementation/mvp-loop.md`).
Goal: reach the MVP validation criteria of `docs/contracts/results-contract.md`
§19 without violating the invariants or coding principles.

## Current state — MVP §19 DONE (demonstrated end-to-end)

All nine results-contract §19 criteria pass as one runnable flow. The CLI
`docker compose run --rm dev npm run mvp -w @kinos/cli` ran green against the
real host Ollama:

```
PASS  a Sphere can be created
PASS  two adults and one child can be added
PASS  each member can have an agent
PASS  the child cannot access private adult memory
PASS  memory can be shared and revoked
PASS  a capability can be allowed for an adult and denied to a child
PASS  a sensitive action can trigger approval
PASS  the system runs with a local model runtime (reachable; models=0)
PASS  data can be exported
```

Built (all in Docker, TDD): Identity/Sphere/Member, Policy Engine (ADR-003),
Memory + policy-scoped Resolver, Agent, Approval (ADR-004), AgentRuntime port +
Ollama adapter (live-verified), export/import, and the `@kinos/cli` acceptance
orchestrator. 60 unit/acceptance tests pass; strict tsc clean.

### Beyond §19 (not required for the §19 milestone; next if the loop resumes)
- **Capability-execution path**: DONE (iteration 14). Catalog + binding + the
  per-call double-check (ADR-001): unknown → deny, profile floor, enabled-binding
  check, Policy Engine re-check, approval floor, execute via CapabilityExecutor
  port. Next sub-step: wire approvals into the execute flow and add a real local
  executor adapter.
- **SQLite persistence + CLI wiring**: DONE. `SphereStore` port (it.11) +
  `@kinos/persistence-sqlite` (it.12) + CLI subcommands `init/list/show/export`
  backed by SQLite at `$KINOS_DB` (it.13). Verified durable across separate
  process runs (results-contract §1 "database is initialized" / §15).
- **Interactive CLI/API commands** (the current CLI runs a scripted scenario,
  not per-command operations) and the **Next.js UI** (results-contract §18).
- **Capability execution path** (binding resolution + per-call policy re-check
  wired to the runtime), Sphere-agent persona (ADR-005 layer 2), audit events
  (event-model), embeddings (derived index).

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
- [x] data can be exported *(core export/import round-trip; CLI/API wiring pending)*

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

### Iteration 9 — 2026-06-25
- **Done:** Export slice in `packages/core/export/export.ts`. SphereExport
  (versioned, self-describing JSON: format/version/exportedAt + sphere,
  identities, agents, memory, policies; embeddings excluded). exportSphere +
  importSphere (fail-closed validation: non-object / unknown format / unsupported
  version / missing sections all throw). Documented the format in
  `docs/architecture/export-format.md` (results-contract §17 requires a
  documented format). 5 tests incl. a JSON round-trip.
- **Verified (in container):** `npm test` → 59 passed, 1 skipped; `typecheck` → exit 0.
- **Milestone:** all nine §19 criteria now pass at the core level.
- **Next step:** Thin CLI in `packages/app/cli` (depends on @kinos/core +
  @kinos/runtime-ollama) that runs the full §19 sequence as one flow: create
  Sphere → add 2 adults + 1 child → create an agent per member → show child
  denied parent's private memory → share then revoke → capability allowed for
  adult / denied for child → trigger an approval → check the local Ollama
  runtime → export. Wire SQLite persistence behind the core repository ports
  (define those ports first; doc-check ADR-002/ADR-006). Document run commands
  (results-contract §1). This converts the unit proofs into an end-to-end demo.

### Iteration 10 — 2026-06-25 — §19 MILESTONE
- **Done:** `@kinos/cli` (`packages/app/cli`). `scenario.ts` `runMvpScenario`
  composes the domain core + injected AgentRuntime port to exercise all nine §19
  criteria, returning a pass/fail report. `main.ts` runs it against the Ollama
  adapter (tsx runner; Node 20 can't run .ts directly) and exits non-zero on
  failure. e2e test `scenario.test.ts` asserts all nine pass with a fake runtime.
  Documented run commands in README (results-contract §1).
- **Verified (in container):** `npm test` → 60 passed, 1 skipped (live
  generation); `typecheck` → exit 0; and **`npm run mvp` printed PASS for all
  nine §19 criteria against the real host Ollama**.
- **Decisions:** §19 is a list of behaviors, not persistence — so the milestone
  is met without SQLite; durability/UI are tracked under "Beyond §19" above.
  Scenario depends on the runtime port (provider-free core); CLI injects Ollama,
  tests inject a fake (deterministic).
- **Loop status:** GOAL reached (§19 demonstrable end-to-end) → loop stopped and
  summarized. Re-invoke `/loop` to continue with the "Beyond §19" items.

### Iteration 11 — 2026-06-25 (post-§19; persistence)
- **Done:** Persistence port `SphereStore` in `packages/core/persistence/store.ts`
  (save/load/list/delete over the documented SphereExport snapshot; embeddings
  not persisted) + `InMemorySphereStore` reference impl that stores/returns JSON
  clones so callers can't mutate persisted state. 5 tests (round-trip, missing →
  undefined, overwrite, delete, mutation isolation). Doc-covered by ADR-006
  ("repository port defined by the domain") + ADR-002.
- **Verified (in container):** `npm test` → 65 passed, 1 skipped; `typecheck` → exit 0.
- **Decisions:** the store persists the canonical export snapshot (reuses the
  documented format) rather than a bespoke schema — keeps SQLite a thin adapter
  and durability aligned with export/import. Clone via JSON to keep core free of
  node/dom globals (no structuredClone).
- **Next step:** SQLite adapter `packages/adapters/persistence-sqlite`
  implementing SphereStore via better-sqlite3 (Dockerfile already has build
  tools). One table keyed by sphere id storing the snapshot JSON. TDD against a
  temp DB file; ideally extract a shared SphereStore contract suite and run it
  for both in-memory and SQLite. Then wire the CLI to persist/reload a Sphere
  (results-contract §1 "database is initialized").

### Iteration 12 — 2026-06-25 (post-§19; SQLite adapter)
- **Done:** `@kinos/persistence-sqlite` (`packages/adapters/persistence-sqlite`).
  SqliteSphereStore implements SphereStore via better-sqlite3 — one `spheres`
  table (id PRIMARY KEY, snapshot JSON), INSERT OR REPLACE, WAL mode, close().
  5 tests against a temp DB file incl. durability across a reopen of the same
  file. better-sqlite3 compiled in-container (Dockerfile build tools).
- **Verified (in container):** `npm test` → 70 passed, 1 skipped; `typecheck` →
  exit 0 across all four packages.
- **Decisions:** adapter tsconfig sets `verbatimModuleSyntax:false` +
  `esModuleInterop:true` locally so the CJS `better-sqlite3` default-imports
  cleanly; core keeps strict module settings. Stores the canonical export
  snapshot as JSON (thin adapter; query-optimised schema deferred until needed).
- **Next step:** Wire the CLI to persistence — `mvp` (or a new subcommand) saves
  the built Sphere via a chosen SphereStore and reloads it, proving
  results-contract §1 "the database is initialized" / §15 local-first durability
  end-to-end. Inject SqliteSphereStore in the CLI (path from env, e.g.
  KINOS_DB), keep InMemory for tests. Consider a tiny arg parser
  (create/list/export) rather than only the scripted scenario.

### Iteration 13 — 2026-06-25 (post-§19; CLI persistence)
- **Done:** CLI subcommand layer. `commands.ts` (provider-free, takes a
  SphereStore): initSphere (create family Sphere + founder identity, persist,
  refuse overwrite), listSpheres, showSphere (summary / "not found"),
  exportSphereJson (re-validates via importSphere before emit). `main.ts` is now
  a dispatcher (`mvp|init|list|show|export`) wiring SqliteSphereStore at
  `$KINOS_DB` (default ./data/kinos.sqlite, dir auto-created). 4 command tests
  with InMemorySphereStore. README documents the commands.
- **Verified (in container):** `npm test` → 74 passed, 1 skipped; `typecheck` →
  exit 0. Live: `init` then **separate-process** `list`/`show` read the Sphere
  back from the SQLite file — durability across runs.
- **Decisions:** command logic stays provider-free (store injected); only main
  wires SQLite. Founder identity displayName defaults to "Administrator" for the
  `init` shortcut; richer member/agent CLI ops deferred.
- **Next step (pick one): (a)** capability-execution path — CapabilityBinding +
  resolver that re-checks policy per call and runs via the AgentRuntime port
  (ADR-001 double-check), wiring approvals into a real execute flow; or **(b)**
  audit events (event-model.md) threaded by correlation id across policy →
  approval → runtime. Both are doc-covered. Lean (a): it makes capabilities
  actually executable, the core value loop. Doc-check capability-catalog +
  integration-model first.

### Iteration 14 — 2026-06-25 (post-§19; capability execution)
- **Done:** Capability-execution pipeline in `packages/core/capability/`.
  `types.ts` (Capability, CapabilityBinding per ADR-001, CapabilityExecutor
  port). `catalog.ts` (defaultCapabilityCatalog — minimal MVP subset with risk,
  allowedProfiles, approvalFloor, auditFacts). `resolver.ts` `executeCapability`
  doing the ADR-001 double-check: unknown→deny, catalog profile default-deny,
  enabled-binding-or-deny, per-call Policy Engine re-check (scoped to binding
  risk + execution), approval floor raises allow→require_approval, then
  execute via the executor / suspend / refuse. 6 tests.
- **Verified (in container):** `npm test` → 80 passed, 1 skipped; `typecheck` → exit 0.
- **Decisions:** executor is a port (fake in tests; local/n8n adapters later).
  Floor-raised approvals default approverRoles to [parent, admin] (policy roles
  used when a policy raises instead). Capability input/output JSON-schema
  validation deferred (types accept `unknown` input for now).
- **Next step:** (i) a local CapabilityExecutor adapter + wire executeCapability
  into the CLI/scenario so a require_approval result creates an ApprovalRequest
  and, once granted, the action runs (closing policy→approval→execution under
  one correlation id); then (ii) audit events (event-model.md) recording
  security facts across that chain. Doc-check event-model first.
