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
- **Audit events**: DONE (iteration 15). KinEvent model + AuditSink port +
  InMemoryAuditSink (event-model.md). executeCapability emits a correlation-
  chained, content-free trail (requested → allowed → executed | denied) citing
  the deciding policy.
- **Sensitive-action orchestration**: DONE (iteration 16).
  `flow/sensitive-action.ts` ties execution + approval under one correlation id:
  begin → (executed | denied | pending_approval with an ApprovalRequest +
  approval.requested); resolve → record decision (approval.granted/denied) →
  grant re-runs the single authorized action (executeCapability honours a
  matching grantedApproval; deny still dominates). Next: durable AuditSink
  adapter; emit lifecycle events (sphere.created, agent.created, memory.*) in
  the command/scenario paths.
- **SQLite persistence + CLI wiring**: DONE. `SphereStore` port (it.11) +
  `@kinos/persistence-sqlite` (it.12) + CLI subcommands `init/list/show/export`
  backed by SQLite at `$KINOS_DB` (it.13). Verified durable across separate
  process runs (results-contract §1 "database is initialized" / §15).
- **Interactive CLI/API commands** (the current CLI runs a scripted scenario,
  not per-command operations) and the **Next.js UI** (results-contract §18).
- **Capability execution path** (binding resolution + per-call policy re-check
  wired to the runtime), Sphere-agent persona (ADR-005 layer 2), audit events
  (event-model), embeddings (derived index).
  - Update: capability execution (it.14), audit events (it.15-16) and a durable
    SQLite audit sink (it.17) are now DONE; Sphere-agent persona and embeddings
    remain.

### Iteration 24 — 2026-06-25 (post-§19; cross-process approval loop CLOSED)
- **Done:** `run` now persists a PendingSensitiveAction when the outcome is
  pending_approval (prints approvalId); new `approveCapability` + CLI
  `approve <approvalId> [grant|deny]` loads the pending action + Sphere, calls
  resolveApproval (records the human decision, audits, re-executes on grant via
  the Sphere's bindings + LocalCapabilityExecutor), and updates the store. main
  wires SqliteApprovalStore ($KINOS_APPROVALS_DB) + a shared localExecutor
  (local.calendar/local.pay/local.echo). 3 command tests.
- **Verified (in container):** `npm test` → 109 passed, 1 skipped; `typecheck` →
  exit 0. **Live cross-process proof:** seeded a payment Sphere → `run` →
  pending_approval (persisted) → **separate-process** `approve grant` → executed;
  `audit <cid>` shows the full chain capability.requested → approval.requested →
  approval.granted → capability.allowed → capability.executed under one
  correlation id.
- **Decisions:** CLI approver is a fixed distinct adult parent ("cli-approver")
  for the demo; quorum>1 / minor-safety approver resolution from real membership
  deferred. The governed sensitive-action loop is now durable and complete CLI-side.
- **Next step:** The whole governance core + adapters + CLI is feature-complete
  for the MVP. Remaining big rocks: the **Next.js UI** (results-contract §18) and
  the **Sphere-agent persona** (ADR-005 L2). Consider pausing the loop and
  summarizing unless continuing to the UI.

### Iteration 23 — 2026-06-25 (post-§19; SQLite approval store)
- **Done:** `SqliteApprovalStore` in `packages/adapters/persistence-sqlite` —
  implements ApprovalStore over a `pending_actions` table (approval_id PK,
  sphere_id, state, payload JSON). listPending filters on the state column;
  durable across reopen. 3 tests.
- **Verified (in container):** `npm test` → 106 passed, 1 skipped; `typecheck` → exit 0.
- **Next step:** wire the CLI — `run` persists a PendingSensitiveAction when the
  outcome is pending_approval (print approvalId); add `approve <approvalId>
  [grant|deny] [--as parent2]` that loads the pending action, calls
  resolveApproval (records decision + audits, re-executes on grant via
  LocalCapabilityExecutor + the Sphere's bindings), updates/clears the store.
  Closes the cross-process suspend→grant→execute loop. Then UI or persona.

### Iteration 22 — 2026-06-25 (post-§19; approval persistence port)
- **Done:** `ApprovalStore` port + `PendingSensitiveAction` (approval + the
  originating CapabilityExecutionRequest) in `packages/core/flow/store.ts`, with
  `InMemoryApprovalStore` (clone in/out; listPending filters state==pending,
  optional sphere). Lets the suspend→grant→execute loop span processes. 4 tests.
- **Verified (in container):** `npm test` → 103 passed, 1 skipped; `typecheck` → exit 0.
- **Decisions:** persist the whole originating request (subject incl.
  role/ageProfile, input, context) so `approve` can resume the one authorized
  execution; approval id is the key.
- **Next step:** SQLite ApprovalStore adapter implementing this contract; then a
  CLI flow — `run` persists a pending action on require_approval, `approve <id>
  [grant|deny]` loads it, records the decision, and on grant re-executes via
  resolveApproval, all durable + audited.

### Iteration 21 — 2026-06-25 (post-§19; governed run command)
- **Done:** `runCapability` command + CLI `run <id> <cap> [adult|child]`. Loads a
  Sphere snapshot, builds CapabilityExecutionDeps from its policies + bindings +
  the catalog + an injected executor, drives beginSensitiveAction with the
  SqliteAuditSink, prints outcome/reason/approval/correlationId. main wires
  LocalCapabilityExecutor (local.calendar/local.echo handlers). 3 command tests
  (executed via executor, deny on missing binding, child denied by profile floor).
- **Verified (in container):** `npm test` → 99 passed, 1 skipped; `typecheck` →
  exit 0. Live: `run` on a fresh Sphere denies (no binding); `run … child` on
  payment denied by catalog profile floor — each with its own correlationId.
- **Decisions:** `run` uses a demo subject derived from profile (adult founder /
  child); real per-member acting identity + an `approve <id>` command (approvals
  aren't persisted yet) deferred. The full governed loop is now invocable from
  the CLI end-to-end.
- **Next step:** persist ApprovalRequests (so a pending `run` can be resolved by
  a later `approve <approvalId>` command, closing the suspend→grant→execute loop
  across processes); OR begin the Next.js UI (results-contract §18). Lean: the
  approval persistence closes the last open governance gap before UI.

### Iteration 20 — 2026-06-25 (post-§19; persist bindings)
- **Done:** Added an optional `bindings` (CapabilityBinding[]) section to the
  SphereExport snapshot — additive, no version bump (a snapshot without it
  imports to []). exportSphere/importSphere updated; export-format.md documents
  it; bindings round-trip + legacy-default tests. This unblocks the governed
  `run` command (it needs a Sphere's bindings + policies).
- **Verified (in container):** `npm test` → 96 passed, 1 skipped; `typecheck` → exit 0.
- **Decisions:** kept EXPORT_VERSION=1 (additive optional field, backward
  tolerant) rather than bumping; runtimeToolName is carried for restoration only.
- **Next step:** CLI `run <sphereId> <capability> [adult|child]` — load the
  snapshot, build CapabilityExecutionDeps from its policies + bindings + the
  catalog + LocalCapabilityExecutor, drive beginSensitiveAction with the
  SqliteAuditSink, print the outcome + correlationId. A fresh Sphere (no
  bindings) denies (deny-by-default); seed a binding/policy via a test snapshot
  to show execute + approval. Then optionally an `init`-seeded default or the UI.

### Iteration 19 — 2026-06-25 (post-§19; local executor adapter)
- **Done:** `@kinos/executor-local` (`packages/adapters/executor-local`).
  LocalCapabilityExecutor implements the CapabilityExecutor port via a handler
  registry keyed by binding.runtimeToolName; an unknown handler throws (failure
  containment, ADR-001). `modelBackedHandler(runtime, {model, system})` routes a
  capability through the AgentRuntime port (for draft/summarize-style
  capabilities). 3 tests with a fake runtime. Pure of native deps; strict tsconfig.
- **Verified (in container):** `npm test` → 95 passed, 1 skipped; `typecheck` → exit 0
  across all five packages.
- **Decisions:** executor decides no permissions (runs only post-policy-check);
  input is passed through as-is (string used verbatim, else JSON-stringified).
- **Next step:** wire a CLI `run <sphereId> <capability>` that loads policies +
  bindings for a Sphere and drives beginSensitiveAction/resolveApproval through
  LocalCapabilityExecutor with the SqliteAuditSink — making the full governed
  execute loop invocable end-to-end. Needs persisting policies/bindings per
  Sphere first (extend the store/snapshot or a small config). Alternatively
  start the Next.js UI (results-contract §18).

### Iteration 18 — 2026-06-25 (post-§19; lifecycle audit + CLI view)
- **Done:** Added `AuditReader` read-interface in core (InMemoryAuditSink
  implements it). `initSphere` now emits a `sphere.created` event when an audit
  sink + correlationId are supplied; `showAudit(reader, cid)` renders a chain
  (facts only). `main.ts` wires a SqliteAuditSink at `$KINOS_AUDIT_DB`, generates
  a correlationId for `init` (printed), and adds an `audit <correlationId>`
  subcommand. README documents it.
- **Verified (in container):** `npm test` → 92 passed, 1 skipped; `typecheck` →
  exit 0. Live: `init` then **separate-process** `audit <cid>` shows the
  persisted `sphere.created` event.
- **Next step:** emit the remaining lifecycle events (agent.created, member.*,
  memory.shared/revoked) where those operations occur (scenario/commands), and
  thread the sensitive-action flow's audit into the SqliteAuditSink so a full
  run is reconstructable. Then choose Sphere-agent persona (ADR-005 L2) or
  embeddings, or start the Next.js UI (results-contract §18).

### Iteration 17 — 2026-06-25 (post-§19; durable audit)
- **Done:** `SqliteAuditSink` in `packages/adapters/persistence-sqlite` —
  implements the core AuditSink over an append-only `audit_events` table (no
  content column, so content cannot leak; privacy-model audit minimality).
  byCorrelation()/all() reconstruct KinEvents with stable `evt_<seq>` ids. 2
  tests incl. durability across a DB-file reopen.
- **Verified (in container):** `npm test` → 90 passed, 1 skipped; `typecheck` → exit 0.
- **Next step:** emit lifecycle events (sphere.created, agent.created, member.*,
  memory.*) from the CLI command + scenario paths, writing to a SqliteAuditSink,
  so a full run leaves a readable, correlation-linked audit history that
  survives restarts. Add a CLI `audit <correlationId>` view. Then consider the
  Sphere-agent persona (ADR-005 layer 2) or embeddings.

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

### Iteration 15 — 2026-06-25 (post-§19; audit events)
- **Done:** Audit event model in `packages/core/audit/events.ts` — KinEvent +
  KinEventType (event-model initial set), EventDecision, AuditSink port,
  InMemoryAuditSink (assigns evt_N ids, byCorrelation()). Threaded an optional
  `audit` sink through executeCapability: emits capability.requested then
  allowed+executed (citing deciding policyId/version) or denied, all sharing the
  correlation id, carrying only ids/decision/reason — verified no input content
  leaks into events. 8 tests (sink + capability audit chain).
- **Verified (in container):** `npm test` → 84 passed, 1 skipped; `typecheck` →
  exit 0 (fixed an exactOptionalPropertyTypes issue in the event builder).
- **Decisions:** require_approval emits no extra capability event here — the
  approval.requested event belongs to ApprovalRequest creation (next step). Audit
  sink is an optional dep so existing call sites are unaffected.
- **Next step:** Orchestrate the full sensitive-action chain in one place:
  executeCapability → on require_approval create an ApprovalRequest (emit
  approval.requested) → on grant (emit approval.granted) re-run execution
  (capability.allowed/executed), all under one correlation id. Add a local
  CapabilityExecutor adapter and surface it via a CLI subcommand. Then a durable
  AuditSink adapter (SQLite) so audit survives restarts.

### Iteration 16 — 2026-06-25 (post-§19; sensitive-action flow)
- **Done:** `packages/core/flow/sensitive-action.ts`. beginSensitiveAction runs
  executeCapability and, on require_approval, creates an ApprovalRequest and
  emits approval.requested. resolveApproval records an approver decision (emits
  approval.granted/denied) and, on a quorum of grants, re-runs the single
  authorized action. executeCapability extended with an optional grantedApproval
  that turns a matching require_approval (same capability + correlation id) into
  execution — single-use; a deny is never overridden, profile/binding checks
  still apply. 4 flow tests; full chain shares one correlation id.
- **Verified (in container):** `npm test` → 88 passed, 1 skipped; `typecheck` → exit 0.
- **Decisions:** the original request is re-supplied to resolveApproval to run
  the authorized action (the approval references, not copies, the action — ADR-004).
  grant matching requires capability name + correlation id to prevent a grant
  authorizing a different action.
- **Next step:** durable AuditSink adapter (SQLite, append-only audit table) so
  the audit trail survives restarts; and emit lifecycle events
  (sphere.created/agent.created/memory.*) from the command + scenario paths so a
  full run leaves a readable, correlation-linked audit history. Doc-check
  privacy-model (audit minimality) before persisting audit.
