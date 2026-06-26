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

### Iteration 34 — 2026-06-26 (post-§19; runtime selection helper, RFC-004)
- **Done:** `packages/app/cli/src/runtime-select.ts` `selectRuntime(config,
  agentModelPreference?, deps?)` — app-layer composition that resolves the
  effective RuntimeProfile, enforces the Sphere's allow rules via the core's
  `assertProfileAllowed` (deny-by-default), then constructs the matching adapter
  (OllamaRuntime local / OpenAiRuntime cloud). Cloud credentials are resolved here
  from `profile.secretRef` through an injected `SecretResolver`; the profile only
  ever holds the reference. No fallback to a default provider on denial/missing
  secret (principle 6). Adapters are imported only in the app layer, never the
  core (principle 1). Added `@kinos/runtime-openai` to the CLI tsconfig
  paths/references + package deps. 6 tests (ollama default, model override,
  openai-when-allowed+secret, provider-not-allowed, cloud-disabled, secret-
  unresolvable).
- **Verified (in container):** `npm install` + `npm test
  packages/app/cli/src/runtime-select.test.ts` → 6 passed; `typecheck` → exit 0.
- **Decisions:** helper lives in the CLI for now; promote to a shared app module
  when the read/write API needs it too. The MVP scenario/`run` still wire Ollama
  directly — switching them to `selectRuntime` (reading the Sphere's persisted
  runtimeConfig) is the natural follow-up.
- **Next step:** wire `selectRuntime` into the governed `run`/scenario paths so a
  Sphere's persisted provider/model actually drives inference; then RFC-006 (dev
  impersonation) to unblock multi-member testing, the governed write API, and the
  RFC-003 UI.

### Iteration 33 — 2026-06-26 (post-§19; persist RuntimeProfile in export, RFC-004)
- **Done:** added an optional `runtimeConfig` (`SphereRuntimeConfig`) section to
  the `SphereExport` snapshot — additive, no version bump (like `bindings` in
  it.20). `exportSphere` defaults it to `defaultRuntimeConfig()` (local-first);
  `importSphere` defaults a missing section to local-first and fails closed on a
  non-object. `export-format.md` documents the field (provider/model, allowed
  providers, cloud flag, secret *reference* only — never the key). Because
  `SqliteSphereStore` persists the whole snapshot JSON, a Sphere's provider/model
  choice is now durable for free (no adapter change). 3 new tests (custom
  round-trip incl. secretRef, default-on-omit, non-object rejected).
- **Verified (in container):** `npm test packages/core/src/export` → 9 passed;
  `typecheck` → exit 0.
- **Decisions:** kept EXPORT_VERSION=1 (additive optional field, backward
  tolerant); cloud credentials are carried as a secret reference in the profile,
  consistent with the secret-store rule.
- **Next step (RFC-004 cont.):** a small selection/wiring helper that, given a
  Sphere's resolved RuntimeProfile, builds the correct adapter (OllamaRuntime vs
  OpenAiRuntime) after `assertProfileAllowed` — the seam the CLI/API will use to
  pick a runtime per Sphere. Then RFC-006 (dev impersonation) to unblock
  multi-member testing, the governed write API, and the RFC-003 UI.

### Iteration 32 — 2026-06-26 (post-§19; OpenAI runtime adapter, RFC-004)
- **Done:** `@kinos/runtime-openai` (`packages/adapters/runtime-openai`) —
  `OpenAiRuntime` implements the core `AgentRuntime` port against the OpenAI HTTP
  API (`GET /models`, `POST /chat/completions`, stream:false), mirroring the
  Ollama adapter. Cloud-specific: it refuses to construct without a resolved API
  key, never embeds the key in errors, and takes the key *injected* (the secret
  store resolves `RuntimeProfile.secretRef` → key upstream; `$OPENAI_API_KEY` is a
  dev-only fallback). Provider SDK stays out of the core (principle 1, 8); the
  adapter decides no permissions. Registered in the root tsconfig references. 6
  mocked-fetch tests (listModels w/ bearer, generate, missing-key refusal,
  key-not-in-error, isAvailable up/down).
- **Verified (in container):** `npm install` (link the new workspace) →
  `npm test packages/adapters/runtime-openai` → 6 passed; `typecheck` → exit 0.
- **Decisions:** key is injected, never a reference the adapter resolves (keeps
  secret handling at the wiring boundary); a live test (real OpenAI call) is
  deferred — it needs a real key and is an external-transfer/cost action.
- **Next step (RFC-004 cont.):** thread `RuntimeProfile` into the Sphere export
  snapshot (additive optional field, like bindings in it.20) + import round-trip,
  so a Sphere persists its provider/model + cloud flag; add a CLI/select wiring
  that builds the right runtime adapter (Ollama vs OpenAI) from a Sphere's
  resolved profile via `assertProfileAllowed`/`resolveEffectiveProfile`. Then
  RFC-006 (dev impersonation), the governed write API, and the RFC-003 UI.

### Iteration 31 — 2026-06-26 (post-§19; config design accepted + RuntimeProfile)
- **Human design round (specs-first):** wrote and the human **accepted** four
  RFCs covering the requested configuration UX: **RFC-003** (Sphere Configuration
  & Admin UI — the UI becomes a governed *write* surface; amends ADR-006's
  "read-only consumer" note), **RFC-004** (Inference Provider & Model
  Configuration — Ollama + OpenAI behind the AgentRuntime port; cloud =
  consent + external-transfer + disableable + minors-denied; boring swap),
  **RFC-005** (Agent Chat Sessions & Conversation History — new Session/Message
  entities, distinct from canonical memory and audit), **RFC-006** (Developer
  Impersonation — dev-only acting-as, deny-by-default, inert in prod, fully
  audited). Propagated "Domain impact" into `domain-model.md` (RuntimeProfile,
  Session, Message, Sphere/Agent fields), `entity-lifecycle.md` (Session
  lifecycle), and the ADR-006 UI note. No code was written before acceptance.
- **First code slice (RFC-004):** `packages/core/src/runtime/profile.ts` — pure
  domain config: `RuntimeProfile` (providerId ollama|openai, model, execution
  local|cloud, baseUrl?, secretRef?), `SphereRuntimeConfig`,
  `createRuntimeProfile` (cloud requires a secret *reference* — keys never in the
  profile), `defaultRuntimeConfig` (local-first: Ollama only, cloud off),
  `assertProfileAllowed` (deny-by-default: provider must be allowed; cloud needs
  cloud-enabled), `resolveEffectiveProfile` (agent model override = boring swap,
  never escalates provider/execution). No provider SDK in core (principle 1).
  Subject authorization (minors-deny-cloud, the grant to enable cloud) is left to
  the Policy Engine, not duplicated here. 8 tests.
- **Verified (in container):** `npm test packages/core/src/runtime/profile.test.ts`
  → 8 passed; full `npm test` → 139 passed, **1 pre-existing live-Ollama
  generation test timed out** (real model call, environmental — unrelated to this
  slice); `typecheck` → exit 0.
- **Next step (RFC-004 cont.):** the OpenAI runtime adapter
  `packages/adapters/runtime-openai` implementing the `AgentRuntime` port (mirror
  `runtime-ollama`; injectable fetch; reads a base URL + a secret-store reference,
  never an inline key). Then thread `RuntimeProfile` into the Sphere snapshot/
  export (additive, like bindings in it.20) so a Sphere persists its provider/
  model choice. After RFC-004: RFC-006 (dev impersonation) to unblock
  multi-member testing, then the governed write API + RFC-003 UI.

### Iteration 30 — 2026-06-25 (post-§19; API e2e over real SQLite)
- **Done:** end-to-end test (`packages/app/api/src/e2e.test.ts`) booting
  createApiServer wired to the **real durable adapters** (SqliteSphereStore/
  ApprovalStore/AuditSink) seeded in a temp dir, then fetching every route the
  UI consumes (/spheres, /spheres/:id, /members, /agents, /approvals). Closes
  the integration gap the per-layer unit tests left (server tests used in-memory
  stores). 2 tests.
- **Verified (in container):** `npm test` → 130 passed, 1 skipped; `typecheck` →
  exit 0. The full read path SQLite → router → HTTP → fetch is proven together.
- **Status:** the MVP is complete and hardened end-to-end — governance core,
  5 adapters, CLI (init/list/show/export/run/approve/audit/mvp), read API + HTTP
  server, Next.js UI (Spheres/members/agents/approvals), durable persistence +
  audit, cross-process approvals. All nine §19 criteria pass; 130 tests green.
- **Next step (optional):** Sphere-agent persona (ADR-005 L2); policy NL
  authoring/compilation (ADR-003); real integration adapters (Google/CalDAV/n8n)
  behind bindings; embeddings index. None are §19 requirements. Natural point to
  pause the loop and summarize.

### Iteration 29 — 2026-06-25 (post-§19; UI Sphere detail + approvals)
- **Done:** extended the read API with `/spheres/:id/members` (id, role, status)
  and `/spheres/:id/agents` (id, name, owner, state, enabledCapabilities) — facts
  only, no private content; 404 on missing sphere. Added UI client getMembers/
  getAgents and pages: `/spheres/[id]` (members + agents) and `/approvals`
  (pending, with approver roles); the Spheres list now links to both. 5 new tests.
- **Verified (in container):** `npm test` → 128 passed, 1 skipped; `typecheck` →
  exit 0; `next build` ✓ (routes /, /approvals static, /spheres/[id] dynamic).
- **Decisions:** member endpoint exposes role/status only (no profile content,
  §18/privacy-model); approvals view shows capability + approver roles, never the
  action payload.
- **Next step:** the UI is read-only feature-complete for the MVP views (Spheres,
  members, agents, approvals). Remaining optional rocks: an end-to-end UI smoke
  (serve API + drive the UI), the Sphere-agent persona (ADR-005 L2), policy
  authoring/NL compilation, real integration adapters. Consider pausing the loop
  and summarizing — the governance MVP + API + UI are complete and §19 fully
  demonstrable.

### Iteration 28 — 2026-06-25 (post-§19; UI build verified)
- **Done:** ran `next build` in-container — compiled successfully, strict-typed
  the app, and prerendered `/` as static. Next auto-reconfigured ui/tsconfig.json
  (added allowJs; intentional, kept). The Spheres page + layout + API client
  type-check and build clean.
- **Verified (in container):** `next build` ✓ (route `/` static, 87 kB first
  load); `npm test` → 123 passed, 1 skipped; workspace `typecheck` → exit 0.
- **Next step:** expand the UI — a Sphere detail page (members/agents) and a
  pending-approvals view via getPendingApprovals, pointed at a running API
  (KINOS_API_URL). Consider an end-to-end smoke (serve API + next build/start)
  later. Add a `next lint`/build step to the doc'd verification flow.

### Iteration 27 — 2026-06-25 (post-§19; Next.js UI scaffold)
- **Human decision:** build the UI as a **Next.js app** per ADR-006 (asked
  before committing to the frontend stack).
- **Done:** scaffolded `ui/` (@kinos/ui): Next 14 app-router skeleton
  (`app/layout.tsx`, `app/page.tsx` server component listing Spheres), config
  (`next.config.mjs`, `tsconfig.json`), and a framework-agnostic API client
  `lib/api.ts` (getSpheres/getSphere/getPendingApprovals, injectable fetch,
  reads `KINOS_API_URL`). Added `ui` to npm workspaces; vitest now includes
  `ui/**/*.test.ts`; `.next/` + next-env.d.ts gitignored. 4 API-client tests.
- **Verified (in container):** `npm install` pulled Next/React; `npm test` →
  123 passed, 1 skipped; `typecheck` (tsc --build, core/adapters/app) → exit 0.
  The UI page/components are validated by `next build`, deferred to next iter.
- **Decisions:** UI is a read-only consumer (coding principle 1 — no policy in
  the UI); it shows Spheres/members, never embeddings/MCP/runtime internals (§18).
  ui is NOT a tsc project reference (Next owns its build/typecheck).
- **Next step:** run `next build` in-container to typecheck/compile the app
  (generates next-env.d.ts); fix any type issues in page/layout. Then add
  members/agents and a pending-approvals view, pointing at a running API.

### Iteration 26 — 2026-06-25 (post-§19; HTTP server for the read API)
- **Done:** `createApiServer(deps)` (`packages/app/api/server.ts`) — a thin
  node:http wrapper mapping IncomingMessage → ApiRequest, calling the pure
  router, writing JSON + an `x-correlation-id` header. `toApiRequest` parses
  method/path/query. `main.ts` wires the SQLite stores (read) and listens on
  `$KINOS_API_PORT` (default 8787); `npm run serve -w @kinos/api`. 2 integration
  tests bind an ephemeral port and fetch (health, sphere summary, 404).
- **Verified (in container):** `npm test` → 119 passed, 1 skipped; `typecheck` →
  exit 0. README documents the API.
- **Decisions:** server holds no logic (transport only); read-only surface.
- **Next step:** the **Next.js UI** (results-contract §18) consuming this API —
  Spheres/members/agents/approvals views, hiding embeddings/MCP/runtime
  internals. Large; consider whether to start it or pause and summarize (the
  governance MVP + API are complete and §19 fully demonstrable).

### Iteration 25 — 2026-06-25 (post-§19; read API router)
- **Done:** `@kinos/api` (`packages/app/api`). `handleApiRequest(req, deps)` — a
  transport-agnostic, read-only router (api-contract.md): GET /health,
  /spheres, /spheres/:id, /approvals[?sphereId], /audit/:correlationId. Every
  response carries a correlation id (generated at entry); errors use the
  contract codes (not_found, invalid_request) and leak no content. Pure handlers
  over the core ports (SphereStore/ApprovalStore/AuditReader) — no HTTP server
  yet. 8 tests.
- **Verified (in container):** `npm test` → 117 passed, 1 skipped; `typecheck` →
  exit 0 across all six packages.
- **Decisions:** read-only metadata surface first (the UI substrate); the router
  performs no authorization the Policy Engine couldn't reproduce. Write/governed
  endpoints (capability request, approvals grant/deny) and a thin Node http
  wrapper deferred to the next slices.
- **Next step:** (a) a thin Node http server in packages/app/api/main wiring the
  router to SQLite stores (so the API is reachable), then (b) the Next.js UI
  (results-contract §18) consuming it. Or pause and summarize — the governance
  MVP is complete and §19 fully demonstrable.

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
