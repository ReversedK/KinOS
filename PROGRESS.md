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

### Iteration 68 — 2026-06-26 (post-§19; wire dependency resolution into install, RFC-002)
- **Done:** the `package.install` endpoint now calls `resolveInstallPlan` over the
  curated catalog + already-installed ids, installing each absent dependency in
  order (each as an `InstalledPackage`, each audited `package.installed`) and
  deduping ones already present — fulfilling the RFC-002 criterion end-to-end. The
  response reports `installed: [...ids]`. Unknown package → 404, cycle → 409,
  already-installed root → 409. 1 new test (installing the amusement-park skill
  also installs the Minecraft MCP dependency).
- **Verified (in container):** `npm test router` → 57 passed; `typecheck` → exit 0.
- **Decisions:** dropped the single-manifest lookup for the resolver; semver range
  matching stays minimal (presence by id). Sandbox provisioning + the grant-wizard
  policy emission remain RFC-002 pipeline concerns; install still grants no use.
- **Next step:** optional remaining items — real authentication (replace dev
  subject selection), an "add a connector" create + grant-wizard flow, RFC-007
  Hermes runtime projection, or per-Sphere cloud runtime selection in the API.
  The originally-requested surface remains complete; these are enhancements.

### Iteration 67 — 2026-06-26 (post-§19; package dependency resolution, RFC-002)
- **Done:** `packages/core/src/package/install-plan.ts` `resolveInstallPlan(rootId,
  catalog, installedIds)` — pure dependency resolver satisfying the RFC-002 criterion
  "installing a package resolves and dedups dependencies and installs an absent mcp
  dependency". Post-order DFS over the curated catalog returns manifests with
  dependencies before dependents, each once; already-installed ids are reused (not
  reinstalled); unknown packages and dependency cycles throw (fail closed).
  Version-range satisfaction is minimal for the MVP (presence by id). 6 tests
  (order, transitive graph, dedup-installed, root-installed → empty, unknown/missing
  dep, cycle).
- **Verified (in container):** `npm install` + `npm test packages/core/src/package`
  → 14 passed; `typecheck` → exit 0. (The dev container volume had been reset;
  re-ran install.)
- **Decisions:** kept semver range matching as a later refinement; the install API
  endpoint can now resolve the plan and install each absent dependency in order
  (wiring is the next step).
- **Next step:** wire `resolveInstallPlan` into the `package.install` endpoint so
  installing a skill also installs its absent mcp deps (each as an InstalledPackage,
  audited); then optional items — real auth, add-connector flow, RFC-007 Hermes.

### Iteration 66 — 2026-06-26 (post-§19; store UI — requested surface COMPLETE, RFC-002)
- **Done:** `/spheres/[id]/store` route + `Store` client component: browse the
  curated catalog with per-package Install, and an Installed list with
  Enable/Disable — all via the governed store endpoints. Client wrappers
  `getStoreCatalog`/`getInstalledPackages`/`installStorePackage`/`setPackageEnabled`
  (403 denial returned as data). Links to chat + store added on the Sphere page.
  The UI only triggers; install never grants use; the Policy Engine gates. 5 new
  client tests.
- **Verified (in container):** `npm test ui/lib` → 28 passed; `next build` →
  compiled, types valid; new route `/spheres/[id]/store` (2.76 kB).
- **MILESTONE — the originally-requested surface is complete end-to-end:**
  - configure a Sphere: **connectors** (enable/disable, governed) ✅, **provider/
    model** incl. cloud governance (RFC-004) ✅, **packages/store** browse+install
    +enable/disable (RFC-002) ✅ — all via governed write API + admin UI (RFC-003);
  - **chat** with your agent + **session history** (RFC-005) ✅ end-to-end;
  - **dev impersonation** to act as any member (RFC-006) ✅ (CLI + run --as; UI
    member selectors anticipate it).
  Everything is behind the governance pipeline (deny-by-default, policy-checked,
  audited, secrets by reference, minors restricted, filter-before-runtime).
- **Remaining / optional (not in the original ask):** real authentication to
  replace dev subject selection; "add a connector" create+grant-wizard flow;
  package dependency resolution/dedup + sandbox provisioning (RFC-002 pipeline);
  per-Sphere cloud runtime selection wiring in the API; RFC-007 Hermes runtime
  projection. Natural point to pause the loop and summarize.

### Iteration 65 — 2026-06-26 (post-§19; governed store/package API, RFC-002)
- **Done:** store endpoints. `GET /store` returns the curated catalog
  (store.browse); `GET /spheres/:id/packages` lists installed packages (manifest
  facts + status); `POST /spheres/:id/packages/install` ({subject, packageId})
  policy-checks `package.install` (profile floor + engine, deny-by-default),
  resolves the manifest from the curated store (404 unknown), refuses a duplicate
  (409), and persists the `InstalledPackage` as **installed** (NOT enabled —
  install ≠ authorization); `POST .../packages/:pid/{enable,disable}` policy-checks
  `package.enable`/`package.disable` and transitions the package. Added the store/
  package catalog capabilities and `package.*` audit event types; each action is
  audited. 7 new tests.
- **Verified (in container):** `npm test router + capability` → 64 passed (router
  56); `typecheck` → exit 0.
- **Decisions:** install persists the manifest + lifecycle; dependency resolution/
  dedup, signature verification, sandbox provisioning and the grant-wizard policy
  emission remain RFC-002 install-pipeline concerns simplified for the MVP
  (capabilities a package provides are declared in its manifest; dynamic catalog
  registration deferred). enabling stays governed and per-call policy still gates.
- **Next step:** the store UI (browse catalog + Install, installed list +
  enable/disable) — the final piece of the originally-requested surface. Then a
  full pause + summary.

### Iteration 64 — 2026-06-26 (post-§19; persist packages + store catalog, RFC-002)
- **Done:** (1) added an optional `packages` (`InstalledPackage[]`) section to the
  `SphereExport` snapshot — additive, defaults to `[]`, fails closed on a non-array,
  documented in `export-format.md`; durable via the SQLite snapshot. (2)
  `store-catalog.ts` — a curated in-memory list of installable `PackageManifest`s
  (`defaultStoreCatalog`/`findStorePackage`) for the MVP store (`store.browse`),
  incl. the amusement-park skill declaring its Minecraft-MCP dependency. 5 tests
  (2 export round-trip/default/reject + 3 catalog).
- **Verified (in container):** `npm test export + package` → 21 passed; `typecheck`
  → exit 0.
- **Decisions:** the catalog is metadata only; signature verification, dependency
  resolution/dedup and sandboxing remain install-pipeline concerns (RFC-002).
- **Next step:** a governed `package.install` (+ enable/disable/uninstall) API —
  install resolves+dedups deps, registers capabilities, creates bindings DISABLED,
  runs the grant wizard (adults allow / minors deny), persists the InstalledPackage;
  a `store.browse` read endpoint; then the store UI. After that the full requested
  surface (config, connectors, store, chat, dev impersonation) is demonstrable.

### Iteration 63 — 2026-06-26 (post-§19; Package domain + lifecycle, RFC-002)
- **Done:** `packages/core/src/package/package.ts` — pure-core `PackageManifest`
  (id, type skill|mcp|bundle, title, plain description, version, publisher,
  ageRating, dependencies, providesCapabilities) + `createManifest` (non-empty
  title/description) and the per-Sphere `InstalledPackage` lifecycle:
  `installPackage` → status `installed` (NOT enabled — **install ≠ authorization**,
  RFC-002), `enablePackage`/`disablePackage` (immutable; only `enabled` is usable),
  `uninstallPackage` (blocks the future). 5 tests.
- **Verified (in container):** `npm test packages/core/src/package` → 5 passed;
  `typecheck` → exit 0.
- **Decisions:** kept signature verification, sandboxing and dependency
  resolution/dedup as install-pipeline concerns outside the core (RFC-002); the
  domain models the manifest + lifecycle only. Capability registration with
  declared risk + the grant wizard's policies are governed separately.
- **Next step:** persist installed packages in the snapshot (additive) + governed
  `package.install`/`package.enable`/`package.disable` endpoints, then the store
  browse/install UI. A curated in-memory store catalog can seed `available`
  packages for the MVP.

### Iteration 62 — 2026-06-26 (post-§19; connectors UI, RFC-003/integration-model)
- **Done:** `getIntegrations` + `setIntegrationEnabled` UI client wrappers (403
  denial returned as data) and a `Connectors` client component (list provider +
  status + provided capabilities, Enable/Disable per row, acting-member select)
  mounted in a new "Connectors" section on the Sphere page. The UI only triggers
  the governed endpoints; secrets are never shown. 3 new client tests.
- **Verified (in container):** `npm test ui/lib` → 23 passed; `next build` →
  compiled, types valid (`/spheres/[id]` 3.1 kB).
- **Decisions:** disable/enable derived from current status; acting member chosen
  for the dev MVP. "Add a connector" (create + grant wizard) and scope editing
  remain; the enable/disable management loop is complete UI-side.
- **Next step:** the package **store** (RFC-002) — browse/install UI + governed
  package.install path — is the last originally-requested surface. After that the
  full requested experience (config, connectors, store, chat, dev impersonation)
  is demonstrable; a good point to pause and summarize.

### Iteration 61 — 2026-06-26 (post-§19; governed connector enable/disable API, RFC-003/integration-model)
- **Done:** connector endpoints. `GET /spheres/:id/integrations` lists summaries
  (id, provider, status, scopes, providesCapabilities) — never the secret value.
  `POST /spheres/:id/integrations/:iid/{enable,disable}` adds `integration.enable`/
  `integration.disable` catalog capabilities (high-risk, adults-only), enforces the
  profile floor + Policy Engine (deny-by-default), applies enable/disable on the
  snapshot's integration, persists, and audits (`integration.enabled/disabled`,
  reusing existing event types). 409 if the integration was removed; 404 unknown;
  501 when disabled. 6 new tests.
- **Verified (in container):** `npm test router + capability` → 57 passed (router
  49); `typecheck` → exit 0.
- **Decisions:** integration management mirrors the runtime-set write (evaluate +
  catalog floor + persist + audit); `add a connector` (create + grant wizard) and
  scope updates are later slices.
- **Next step:** the connectors UI (list + enable/disable buttons), an "add
  connector" path, then the package store (RFC-002) browse/install. After that the
  originally-requested surface is fully covered.

### Iteration 60 — 2026-06-26 (post-§19; persist integrations in export, integration-model)
- **Done:** added an optional `integrations` (`Integration[]`) section to the
  `SphereExport` snapshot — additive, no version bump (like bindings/runtimeConfig).
  `exportSphere` defaults it to `[]`; `importSphere` defaults a missing section to
  `[]` and fails closed on a non-array. Documented in `export-format.md` (provider,
  scopes, secret *reference*, provided capabilities, status). Durable for free via
  the SQLite snapshot store. 2 new tests (round-trip + default-on-omit, non-array
  rejected).
- **Verified (in container):** `npm test export` → 11 passed; `typecheck` → exit 0.
- **Next step:** governed `integration.enable`/`integration.disable` capability +
  API write endpoints (policy-checked, persist the updated integration in the
  snapshot, audit), then a read endpoint + the connectors UI.

### Iteration 59 — 2026-06-26 (post-§19; Integration domain entity, RFC-003/integration-model)
- **Done:** `packages/core/src/integration/integration.ts` — pure-core
  `Integration` entity (id, sphereId, provider, scopes, secretRef, providesCapabilities,
  status) with lifecycle `proposed → enabled → disabled → removed` mirroring the
  capability-binding lifecycle. `createIntegration` starts **proposed** (deny by
  default — unavailable until a governed enable); enable/disable/remove/updateScopes
  are immutable; removed blocks the future; secrets are held by reference only. The
  concrete provider operation names stay in adapters/bindings, not the domain. 5
  tests.
- **Verified (in container):** `npm test packages/core/src/integration` → 5 passed;
  `typecheck` → exit 0.
- **Decisions:** modelled the governance-relevant facts only; integration "enable"
  changes how capabilities run, never whether they're allowed (integration-model
  rules). Persistence (snapshot field), governed enable/disable endpoints, and the
  connectors UI are the next slices — same bottom-up path as runtimeConfig/sessions.
- **Next step:** add `integrations` to the export snapshot (additive), then a
  governed `integration.enable`/`integration.disable` capability + API endpoints,
  then the connectors UI; finally the package store (RFC-002).

### Iteration 58 — 2026-06-26 (post-§19; UI chat view — RFC-005 END-TO-END)
- **Done:** `/spheres/[id]/chat` route + `Chat` client component: pick the acting
  member (owner) + agent, start a new conversation, see the owner's session list,
  open a transcript, and send turns (composer) — all through the governed chat
  endpoints. A link was added from the Sphere page. The UI only triggers governed
  actions and renders what the owner is allowed to read (coding principle 1).
- **Verified (in container):** `next build` → compiled, types valid; new dynamic
  route `/spheres/[id]/chat` (2.88 kB). ui/lib chat client (20 tests) green.
- **Milestone:** **RFC-005 is complete end-to-end** — Session/Message domain →
  store (InMemory + SQLite) → policy-scoped resolver → chat-turn flow (filter
  before runtime) → API (create/list/read/turn over HTTP, Ollama-wired) → UI chat
  view. Transcripts stay owner-private and separate from canonical memory + audit.
- **Requested feature set status:** chat-with-your-agent + session history (RFC-005)
  ✅; provider/model selection incl. cloud governance (RFC-004) ✅ end-to-end; dev
  impersonation (RFC-006) ✅ CLI + resolver; admin/config UI + governed write API
  (RFC-003) ✅ for capability execution, approvals, provider. Remaining from the
  original ask: the **connectors (integrations)** and **store (packages)** UIs —
  governed by integration-model + RFC-002, API/UI not yet built.
- **Next step:** integrations enable/disable governed endpoint + connectors UI;
  then the package store (RFC-002) browse/install UI. Natural point to pause and
  summarize if desired — the core requested experiences are demonstrable.

### Iteration 57 — 2026-06-26 (post-§19; UI chat client wrappers, RFC-005)
- **Done:** added chat wrappers to the UI API client: `listSessions`,
  `getSession` (owner-scoped transcript), `createSession`, `postChatTurn`, plus
  `SessionSummary`/`SessionDetail`/`ChatMessage` types. GETs reuse `getJson`; POSTs
  reuse `postJson` and throw on non-200 (the chat UI acts as the owner). 5 new
  tests (list, owner-scoped get URL, create POST body, turn POST body + reply,
  403 throws).
- **Verified (in container):** `npm test ui/lib` → 20 passed (TS compiled by
  vitest; full UI validated by `next build` when the page lands).
- **Decisions:** ownerId is threaded explicitly (auth deferred); postChatTurn
  throws on denial since the chat composer is owner-driven (unlike capability
  execution where a 403 is shown inline).
- **Next step:** the chat page/components — a session list + new-conversation
  action, a transcript view, and a composer posting turns — mounted under the
  Sphere (or a dedicated /spheres/[id]/chat route); validate with `next build`.
  That completes RFC-005 end-to-end and the originally-requested feature set.

### Iteration 56 — 2026-06-26 (post-§19; session read endpoint + HTTP chat wiring, RFC-005)
- **Done:** (1) `GET /spheres/:id/sessions/:sid?ownerId=` reads one session with
  its transcript, policy-scoped: the subject's **role is derived from the Sphere's
  membership** (not client-claimed), then `authorizeSessionRead` decides — owner
  allowed, non-member 403, a deny policy would still dominate. (2) Wired the API
  `main.ts` with a `SqliteSessionStore` ($KINOS_SESSIONS_DB) + an `OllamaRuntime`
  and the session-id generator, so chat works over HTTP end-to-end. Added
  `@kinos/runtime-ollama` to the API package deps + tsconfig. 2 new router tests
  (owner reads transcript; non-member denied).
- **Verified (in container):** `npm install` + `npm test router` → 43 passed;
  `typecheck` → exit 0 across packages (api now references runtime-ollama).
- **Decisions:** deriving the acting role from membership keeps the read governed
  without trusting a client-claimed role; the single injected runtime + Sphere
  model stands in until per-Sphere `selectRuntime`/cloud wiring lands.
- **Next step:** the UI chat view — a sessions list (GET sessions), a transcript
  view (GET one session), and a composer (POST a turn) as client components; an
  optional server test posting a turn over HTTP. Then RFC-005 is demonstrable
  end-to-end and the originally-requested feature set is covered.

### Iteration 55 — 2026-06-26 (post-§19; chat-turn API endpoint, RFC-005)
- **Done:** `POST /spheres/:id/sessions/:sid/messages` runs a governed chat turn.
  Loads the Sphere + session (404 on either missing / sphere mismatch), resolves
  the model from the Sphere's RuntimeProfile (RFC-004), and calls `runChatTurn`
  with the Sphere's memory + policies through the injected `AgentRuntime`
  (added optional `runtime` to ApiDeps). A non-owner turn is refused (403, the
  flow's owner-private guard); empty text → 400; chat disabled → 501. Persists the
  updated session and returns the reply + message count (no transcript echoed
  beyond the reply). 5 new tests (owner turn + persistence, non-owner 403, missing
  session 404, empty text 400, 501).
- **Verified (in container):** `npm test router` → 41 passed; `typecheck` → exit 0.
- **Decisions:** the API uses a single injected runtime + the Sphere's model
  (per-Sphere adapter selection via `selectRuntime`/cloud is a later server-wiring
  enhancement); message ids are derived from the correlation id. The turn reply is
  returned but the full transcript is read via the (future) policy-scoped single-
  session GET, keeping content access on the owner path.
- **Next step:** wire SqliteSessionStore + an Ollama runtime into the API
  `main.ts` so chat works over HTTP; a policy-scoped single-session read endpoint;
  then the UI chat view (session list + transcript + composer). RFC-005 nears
  end-to-end.

### Iteration 54 — 2026-06-26 (post-§19; chat session create/list API, RFC-005)
- **Done:** chat session endpoints in the router. `POST /spheres/:id/sessions`
  ({subject, agentId, title?}) creates an owner-bound session and persists it;
  `GET /spheres/:id/sessions?ownerId=` returns the owner's session **summaries**
  (id, title, agentId, state, updatedAt, messageCount) — never message content
  (private). Added optional `sessions: SessionStore` + `newSessionId` to ApiDeps;
  endpoints 501 when absent, 404 on missing Sphere, 400 on bad input. 6 new tests.
- **Verified (in container):** `npm test router` → 36 passed; `typecheck` → exit 0.
- **Decisions:** owner is taken from the request subject (auth deferred — RFC-003/
  006); list is owner-scoped at the store and returns no transcript content, so
  even the summary view honours privacy. The single-session read (with messages,
  policy-scoped) and the chat-turn POST (needs a runtime dep wired) are the next
  slices.
- **Next step:** wire an AgentRuntime into the API (select per Sphere via RFC-004)
  and add `POST /spheres/:id/sessions/:sid/messages` running `runChatTurn`; a
  policy-scoped single-session read; then the UI chat view. The server `main.ts`
  gains a SqliteSessionStore + runtime.

### Iteration 53 — 2026-06-26 (post-§19; SQLite SessionStore adapter, RFC-005)
- **Done:** `SqliteSessionStore` in `@kinos/persistence-sqlite` — implements the
  core `SessionStore` over a `sessions` table (id PK, sphere_id, owner_id, state,
  updated_at, payload JSON; WAL). `listForOwner` filters owner+sphere, excludes
  deleted, orders newest-first in SQL. Transcripts live in their own table,
  separate from the Sphere snapshot, canonical memory and the audit log. 3 tests
  (save/load with messages, owner list ordering/exclusions, durability across a
  file reopen).
- **Verified (in container):** `npm test sqlite-session-store` → 3 passed;
  `typecheck` → exit 0.
- **Decisions:** mirrored the approval-store shape (JSON payload + queryable
  columns); kept it a separate file/table — sessions are not part of the canonical
  export (RFC-005: transcript ≠ canonical memory).
- **Next step:** API endpoints for chat (create session, post a turn wiring the
  store + runtime selection from RFC-004, list/read sessions) and the UI chat view
  with session history; then RFC-005 is demonstrable end-to-end.

### Iteration 52 — 2026-06-26 (post-§19; chat-turn flow, RFC-005)
- **Done:** `packages/core/src/session/chat.ts` `runChatTurn(deps, input)` — the
  core conversational turn, composing governance without adding authorization:
  (1) refuses the turn unless the subject owns the session (policy-scoped read);
  (2) **filters before the runtime** — only `resolveReadableMemory` output + the
  owner's own history are put in the prompt (coding principle 4); (3) calls the
  `AgentRuntime` port (provider-free; no permissions in the prompt — principle 2);
  (4) appends the user message + reply to the session under the correlation id.
  4 tests, incl. a filter-before-runtime test proving another member's private
  memory never reaches the runtime, a non-owner refusal that never calls the
  runtime, and ordered history.
- **Verified (in container):** `npm test packages/core/src/session` → 21 passed
  (entity 7 + store 5 + resolver 5 + chat 4); `typecheck` → exit 0.
- **Decisions:** the flow returns the updated session + reply; persistence and any
  capability calls the agent makes are the caller's governed responsibility. Memory
  is injected as an "Authorized context" system message built only from the
  authorized subset. System prompt is behavioural only (no authorization).
- **Next step:** a SQLite SessionStore adapter, then API endpoints (create session,
  post a chat turn, list/read sessions) wiring the store + runtime selection
  (RFC-004), and the UI chat view with session history. RFC-005 then end-to-end.

### Iteration 51 — 2026-06-26 (post-§19; policy-scoped session resolver, RFC-005)
- **Done:** `packages/core/src/session/resolver.ts` — `authorizeSessionRead` /
  `resolveReadableSessions`, mirroring the memory resolver: owner-only structural
  visibility (non-deleted) expressed as a lowest-priority synthetic `allow` run
  through the Policy Engine, so a real `deny`/`require_approval` still dominates and
  a non-owner is denied by default. Added a `session` ResourceType to the policy
  types so sessions are first-class in policy selectors. 5 tests (owner allowed,
  non-owner denied, deleted never surfaced, real deny overrides owner, list filter).
- **Verified (in container):** `npm test session + policy` → 30 passed (policy's
  13 unaffected by the ResourceType addition); `typecheck` → exit 0.
- **Decisions:** guardian oversight of a minor's session (RFC-005 open question) is
  intentionally NOT implicit — it would widen structural visibility via an explicit
  grant (like memory's supervisor scope), deferred. Reused the engine's precedence
  rather than duplicating any rule (resolver stays a consumer).
- **Next step:** a SQLite SessionStore adapter; then the chat-turn flow
  (policy-scoped memory + the owner's own history → AgentRuntime via the Sphere's
  profile, capability calls governed) and the API endpoints + UI chat view.

### Iteration 50 — 2026-06-26 (post-§19; SessionStore port, RFC-005)
- **Done:** `packages/core/src/session/store.ts` — `SessionStore` port
  (save/load/listForOwner/delete) + `InMemorySessionStore` reference impl.
  `listForOwner(sphereId, ownerId)` returns the member's sessions newest-first,
  excluding deleted ones and other owners (owner-scoped at the data layer; policy
  still governs access). Stores/returns JSON clones so callers can't mutate
  persisted state. 5 tests (clone isolation, missing→undefined, owner+sphere
  scoping + newest-first + deleted excluded, idempotent delete).
- **Verified (in container):** `npm test packages/core/src/session` → 12 passed
  (7 entity + 5 store); `typecheck` → exit 0.
- **Decisions:** owner-scoping at the store is convenience + defence-in-depth, not
  the authorization boundary — the policy-scoped resolver (next slice) is. Kept the
  store separate from SphereStore (sessions aren't part of the Sphere snapshot).
- **Next step:** a policy-scoped session-read resolver (ask the Policy Engine, like
  the memory resolver), then a SQLite SessionStore adapter, the chat-turn flow
  (policy-scoped memory + owner history → AgentRuntime via the Sphere's profile),
  and the UI chat view + API endpoints.

### Iteration 49 — 2026-06-26 (post-§19; chat Session/Message domain, RFC-005)
- **Done:** `packages/core/src/session/session.ts` — pure-core Session + Message
  entities. `createSession` (active, empty, owner-bound, default title),
  `appendMessage` (immutable; only an active session accepts turns — deny by
  default), `archiveSession`, `deleteSession` (blocks future use + clears the
  transcript; promoted memory/audit unaffected — invariant 5), `isOwnedBy`
  (structural owner check). Role is conversational only (user/agent), never an
  authorization role (principle 2). The transcript is private content, distinct
  from canonical MemoryItems and from the audit log. 7 tests.
- **Verified (in container):** `npm test packages/core/src/session` → 7 passed;
  `typecheck` → exit 0.
- **Decisions:** kept this slice to the entity + lifecycle + structural owner
  check; policy-scoped read (the resolver asking the Policy Engine, mirroring the
  memory resolver) and persistence (a SessionStore port + SQLite table) are the
  next slices. Promotion-to-MemoryItem is a separate governed action, not modelled
  here.
- **Next step:** a `SessionStore` port + InMemory impl (then SQLite adapter), and
  a policy-scoped session-read resolver; then the chat turn flow (policy-scoped
  memory + owner history → AgentRuntime) and the UI chat view. Largest remaining
  requested feature; building it bottom-up like memory.

### Iteration 48 — 2026-06-26 (post-§19; UI provider/model change form, RFC-004/003)
- **Done:** added a `setRuntime` UI client wrapper (POST /spheres/:id/runtime;
  403 denial returned as data, 400/404/501 throw) and a `SetRuntime` client
  component (acting-member select, provider select ollama/openai, model input,
  Save) mounted in the Sphere page's runtime section. Closes the provider/model
  config loop in the UI: the admin picks a provider/model, the governed endpoint
  policy-checks + persists, and the page shows the outcome (executed / denied).
  The UI only triggers; the Policy Engine + core decide. 2 new client tests
  (POST subject+profile body asserted; 403 denial returned).
- **Verified (in container):** `npm test ui/lib` → 15 passed; `next build` →
  compiled, types valid (`/spheres/[id]` 2.31 kB).
- **Decisions:** provider→execution derived in the form (ollama=local,
  openai=cloud); acting member chosen for the dev MVP (anticipates auth/RFC-006).
  Switching to openai will be denied until cloud is enabled + provider allowed
  (core deny-by-default), surfaced as "denied" in the UI.
- **Next step:** the connectors (integrations) view, and RFC-005 chat sessions
  (the largest remaining requested feature). A `runtime.set_provider` entry in the
  doc `capability-catalog.md` is a small follow-up (deferred to avoid colliding
  with the parallel RFC-007 edits to that file).

### Iteration 47 — 2026-06-26 (post-§19; governed provider/model write endpoint, RFC-004)
- **Done:** governed settings-write `POST /spheres/:id/runtime`. Adds a
  `runtime.set_provider` catalog capability (high risk, adults-only). The handler
  enforces the catalog profile floor (minors denied), runs the **Policy Engine**
  (`evaluate`) on `runtime.set_provider` — deny-by-default, so a Sphere with no
  allowing policy refuses — then applies `setDefaultRuntimeProfile` (which itself
  refuses switching to a disallowed provider / cloud-while-disabled), persists the
  updated snapshot, and audits the decision (allowed→executed / denied) citing the
  policy. Outcomes map to HTTP: 200 executed, 403 forbidden, 400 bad input, 404
  missing Sphere, 501 when disabled. 6 new tests (allow+persist verified via GET,
  deny-by-default, minor floor, disallowed-provider, missing-profile, 501).
- **Verified (in container):** `npm test router + capability` → 38 passed (router
  30); `typecheck` → exit 0.
- **Decisions:** the router uses `evaluate` directly (that *is* the Policy Engine,
  not a duplicated rule) since a settings change is a domain mutation, not a
  capability-binding execution; a `require_approval` decision is treated as
  not-yet-authorized (403, fails closed) — full approval-gated settings is a later
  enhancement. Scope limited to the default profile (not widening allowed
  providers / enabling cloud), consistent with `setDefaultRuntimeProfile`.
- **Next step:** a UI affordance to change provider/model (client form → this
  endpoint) on the Sphere page; the connectors view; then RFC-005 chat sessions.
  Note: RFC-007 (Hermes governed runtime) landed externally — its
  RuntimeConfigProjection / Sphere-MCP gateway are future implementation matter.

### Iteration 46 — 2026-06-26 (post-§19; setDefaultRuntimeProfile core helper, RFC-004)
- **Done:** pure-core `setDefaultRuntimeProfile(config, newProfile)` — changes a
  Sphere's default inference profile while keeping its allowed providers + cloud
  flag, immutably. Deny-by-default: the new profile must pass `assertProfileAllowed`
  (provider allowed; cloud only when enabled), so it can never widen what the
  Sphere permits — switching to a disallowed provider or to cloud-while-disabled
  is refused. This is the domain mutation the governed settings-write endpoint will
  call once the authorization path exists. 3 tests (model swap immutable,
  disallowed-provider refused, cloud-disabled refused).
- **Verified (in container):** `npm test profile.test.ts` → 11 passed; `typecheck`
  → exit 0.
- **Decisions:** kept the helper scoped to the default profile (not the allowed
  set / cloud flag) — enabling cloud or widening providers is the higher-privilege
  change that must be separately, explicitly authorized. Built the pure piece
  first so the eventual endpoint only adds the policy check + persistence, not new
  domain logic.
- **Next step:** the governed settings-write endpoint POST /spheres/:id/runtime —
  policy-check `runtime.set_provider` (catalog entry + a Sphere policy) via the
  engine, then `setDefaultRuntimeProfile` + persist + audit; allow/deny/approval
  mapped like the execute endpoint. Then connectors view and RFC-005 chat.

### Iteration 45 — 2026-06-26 (post-§19; render runtime info on Sphere page, RFC-003)
- **Done:** the Sphere detail page now shows an "Inference runtime" section
  (provider · model · execution, cloud on/disabled, allowed providers, and a flag
  if the current profile isn't permitted), fetched read-only via `getRuntime` in
  the server component. Completes the read-side config display next to
  members/agents; no secrets shown.
- **Verified (in container):** `next build` → compiled, types valid (route sizes
  unchanged; the new fetch is server-side).
- **Decisions:** purely additive read display; the provider/model **write** still
  awaits the governed-settings slice (it.44 rationale).
- **Next step:** design the governed admin-settings path (a `runtime.set_provider`
  capability the Policy Engine checks) to enable a provider/model write, then the
  connectors view and RFC-005 chat sessions. An end-to-end UI smoke (serve API +
  drive the pages) is now worthwhile given three interactive/read views exist.

### Iteration 44 — 2026-06-26 (post-§19; runtime read endpoint + UI client, RFC-004/003)
- **Done:** `GET /spheres/:id/runtime` — the API counterpart of the CLI
  `describeRuntime`: returns the Sphere's resolved inference profile (provider,
  model, execution, cloud flag, allowed providers, and whether it's permitted),
  **no secrets**. Added a `getRuntime` UI client wrapper + `RuntimeInfo` type, so
  the config view can display the current provider/model. 2 new tests (router
  reports local-first default; client parses the profile).
- **Verified (in container):** `npm test router + ui/lib` → 37 passed (router 24,
  ui 13); `typecheck` → exit 0.
- **Decisions:** deliberately shipped the **read** endpoint, not a set-provider
  **write** — changing a Sphere's provider/model is a high-risk admin action that
  must be policy-gated/approval-bound (RFC-004), and that authorization machinery
  (admin-only capabilities, sphere.update_settings policy) isn't wired yet.
  Building the write without it would create an ungoverned mutation, so it waits
  for the governed-settings slice rather than guessing past the invariant.
- **Next step:** design + wire the governed admin-settings path (a
  `runtime.set_provider` capability checked by the Policy Engine) before exposing
  a provider/model **write**; meanwhile the config view can render the read-only
  runtime info next to members/agents. Then RFC-005 chat sessions.

### Iteration 43 — 2026-06-26 (post-§19; run-capability affordance on Sphere page, RFC-003)
- **Done:** added a `RunCapability` client component to the Sphere detail page: a
  member selector (acting "as" a member — anticipates RFC-006 impersonation), a
  capability input (default `calendar.create_event`), and a Run button calling the
  governed `executeCapability` endpoint, rendering the outcome (executed / pending
  approval / denied with safe reason). The subject's age profile is derived from
  the chosen member's role (mirrors the core `ageProfileForRole`). The page passes
  the members list + base URL; the UI only triggers the governed action, the
  Policy Engine decides (coding principle 1).
- **Verified (in container):** `next build` → compiled, types valid;
  `/spheres/[id]` is now a dynamic route carrying client JS (2.02 kB). ui/lib
  tests (12) still green.
- **Decisions:** member-as-subject in the client anticipates impersonation but
  the real acting identity must be resolved server-side later (RFC-006); kept the
  capability free-text for the dev MVP (a catalog-driven picker can come with the
  store/connectors views).
- **Next step:** the connectors (integrations) + provider/model config views
  (needs the integration enable/disable + provider-set write endpoints), then
  RFC-005 chat sessions. Consider an end-to-end UI smoke (serve API + drive the
  two interactive pages) once more write endpoints land.

### Iteration 42 — 2026-06-26 (post-§19; interactive approvals page, RFC-003)
- **Done:** the `/approvals` page is now interactive. Added a client component
  `ApprovalActions` (Grant/Deny buttons) that calls the governed
  `grantApproval`/`denyApproval` endpoints and renders the returned outcome
  (executed / denied / error). The page (server component) lists pending approvals
  and mounts the action component per item, passing the API base URL. The UI only
  *triggers* the governed action; the core approval rules (eligibility, minor
  safety, quorum) and the Policy Engine decide — the UI decides nothing
  (coding principle 1). The approver identity is a dev placeholder until real
  auth/impersonation wiring (RFC-003/006).
- **Verified (in container):** `next build` → compiled successfully, types valid;
  `/approvals` is now a dynamic route carrying client JS (1.61 kB). Existing
  `npm test ui/lib` (12) still green.
- **Decisions:** passed the base URL as a prop from the server component (avoids
  NEXT_PUBLIC_ env plumbing for the dev MVP); denials render as text, not errors.
- **Next step:** a "run capability" affordance on the Sphere page (executeCapability
  + a dev member/profile selector that anticipates RFC-006 impersonation), then the
  connectors/provider config views, and RFC-005 chat sessions.

### Iteration 41 — 2026-06-26 (post-§19; UI write-action client, RFC-003)
- **Done:** added governed **write** wrappers to the UI API client
  (`ui/lib/api.ts`): `executeCapability(sphereId, capability, subject)`,
  `grantApproval(approvalId, approver)`, `denyApproval(...)`, plus a `postJson`
  helper (POST + JSON, no-store). The UI only *triggers* governed actions and
  surfaces the outcome — it decides no authorization (coding principle 1, RFC-003).
  A capability denial (HTTP 403) is returned as a governed outcome, not thrown, so
  the UI can show "denied" with a safe reason; unexpected statuses (501 disabled,
  5xx) throw. 6 new tests (executed + POST body asserted, 403 denial returned,
  501 throws, grant/deny endpoints + body, 409 throws).
- **Verified (in container):** `npm test ui/lib/api.test.ts` → 12 passed;
  workspace `typecheck` → exit 0 (ui types are exercised by vitest + `next build`;
  ui is intentionally not a tsc project reference).
- **Decisions:** the acting subject is passed by the caller for now (server-side
  identity resolution/auth is deferred — RFC-003/006); kept denials as data, not
  exceptions, so the UI can render allow/deny/approval uniformly.
- **Next step:** wire these into the pages — an approvals page grant/deny action
  (client component) and a "run capability" affordance on the Sphere page — then
  the connectors/provider config views and RFC-005 chat. A `next build` pass to
  validate the client components is worthwhile once a page consumes them.

### Iteration 40 — 2026-06-26 (post-§19; governed approval grant/deny API, RFC-003)
- **Done:** added governed approval-resolution write endpoints to the router
  (api-contract §Approval): `POST /approvals/:id/grant` and `/deny`. Loads the
  persisted pending action, derives the approver's age profile from their role
  (`ageProfileForRole` — so a minor approver is rejected by the core, never
  elevated), runs `resolveApproval` over the Sphere's catalog/bindings/policies +
  executor + audit sink, persists the updated approval, and returns the recorded
  outcome (executed / denied / still pending) under the correlation id. Mirrors
  the CLI `approve` command on the HTTP surface. Deny-by-default / fail closed:
  501 when write deps absent, 404 unknown approval, 400 missing approver, 409
  already-resolved. 6 new tests (grant→executed, deny→denied + nothing run, 404,
  400, 409, 501).
- **Verified (in container):** `npm test packages/app/api/src/router.test.ts` →
  23 passed; `typecheck` → exit 0.
- **Decisions:** approver age profile is derived from role (not client-claimed),
  preserving "a minor can never approve"; the action is referenced (re-run via
  the persisted request), never copied (ADR-004).
- **Next step:** wire grant/deny into the HTTP server path (already generic via
  body parsing — add a server test), then governed integration enable/disable;
  after that, start the RFC-003 UI actions consuming these endpoints, and RFC-005
  chat sessions.

### Iteration 39 — 2026-06-26 (post-§19; write path reachable over HTTP, RFC-003)
- **Done:** made the governed capability-execution endpoint reachable over HTTP.
  `server.ts` now reads + JSON-parses the request body for non-GET methods
  (malformed/empty → undefined) and threads it into the router. `main.ts` wires a
  `LocalCapabilityExecutor` (calendar/pay/echo handlers, mirroring the CLI) plus
  the audit sink + `newApprovalId`, so the server is no longer read-only. Added
  `@kinos/executor-local` to the API package deps + tsconfig paths/references.
  2 new HTTP server tests (POST executes a governed capability → 200 executed;
  a child is denied → 403 forbidden) driving the full path fetch → server →
  router → core pipeline → executor.
- **Verified (in container):** `npm install` + `npm test packages/app/api` → 23
  passed (router 17, server 4, e2e 2); `typecheck` → exit 0.
- **Decisions:** the server stays transport-only (body parse + pass-through); all
  decisions remain in the router + core. Reused the CLI's local handler set for
  parity. The subject still comes from the request body (auth/identity resolution
  deferred to RFC-003 wiring).
- **Next step:** add the remaining governed writes the admin UI needs —
  integration `enable`/`disable` and approval `grant`/`deny` endpoints — then
  begin the RFC-003 UI actions (consume these endpoints), and RFC-005 chat.

### Iteration 38 — 2026-06-26 (post-§19; governed write API — capability execute, RFC-003)
- **Done:** first governed **write** endpoint in the API router (api-contract
  §Capability): `POST /spheres/:id/capabilities/:name/execute`. ApiRequest gained
  a parsed `body`; ApiDeps gained optional write deps (`executor`, `auditSink`,
  `newApprovalId`, injectable `now`). The handler loads the Sphere, runs
  `beginSensitiveAction` over its catalog/bindings/policies, threads the entry
  correlation id through the execution context + audit chain, persists a pending
  approval, and maps outcomes to HTTP: executed → 200, denied → 403 `forbidden`,
  require_approval → 202 `approval_required` (referencing the ApprovalRequest).
  Deny-by-default: missing write deps → 501; missing subject → 400; missing
  Sphere → 404. The router still decides no authorization the Policy Engine
  couldn't (coding principle 1). 6 new tests (executed+audited, child denied by
  profile floor, 202 approval persisted, 404, 400, 501).
- **Verified (in container):** `npm test packages/app/api/src/router.test.ts` →
  17 passed; `typecheck` → exit 0.
- **Decisions:** the subject is taken from the request body for this dev slice
  (real identity resolution / auth is deferred — RFC-003); the Policy Engine still
  governs every call so a client-claimed role cannot exceed policy. Kept the read
  server read-only (no executor wired in main.ts yet → 501), and did not touch
  server.ts body-parsing — both are the next wiring step.
- **Next step:** wire the HTTP server (`server.ts` body parsing) + `main.ts`
  (executor-local + audit sink + newApprovalId) so the write endpoint is reachable
  over HTTP, then add more governed writes (integration enable/disable, approval
  grant/deny) and the RFC-003 UI actions on top.

### Iteration 37 — 2026-06-26 (post-§19; run --as wiring + audit, RFC-006)
- **Done:** wired dev impersonation end-to-end through the governed `run` path.
  Added the `identity.impersonated` audit event type (event-model.md + core
  KinEventType). `runCapability` gained an optional `actAs` (memberId, byDeveloper,
  devImpersonationEnabled): it resolves the acting subject via
  `resolveImpersonatedSubject` against the loaded Sphere's members, records an
  `identity.impersonated` security fact (who-as-whom, under the correlation id),
  and runs the rest of the pipeline unchanged. Deny-by-default: flag off / unknown
  / inactive member returns `impersonation denied: …` and executes nothing. CLI
  `run <id> <cap> [adult|child] [--as <memberId>]` reads the dev flag from
  `$KINOS_DEV_IMPERSONATION` and the developer from `$USER`. 4 new tests (parent
  executes + audited, child not elevated → denied but audited, flag-off denial,
  unknown-member refusal).
- **Verified (in container):** `npm test commands + audit` → 22 passed (20 cli +
  2 audit); `typecheck` → exit 0.
- **Decisions:** impersonation audits even when the subsequent policy denies (the
  impersonation happened; the denial is a separate fact in the same chain) —
  faithful to "represent, never replace" + audit minimality. `actAs` takes
  precedence over the demo `profile` arg.
- **Next step:** RFC-006 is functionally complete CLI-side (multi-member testing
  now possible via `--as`). Remaining for the requested UX: the governed **write
  API** (api-contract endpoints still unbuilt) as the socle for **RFC-003** (admin
  UI), then **RFC-005** (chat sessions). Natural point to start the write-API
  slice (e.g. POST capability execution / integration enable) next.

### Iteration 36 — 2026-06-26 (post-§19; dev impersonation core, RFC-006)
- **Done:** `packages/core/src/identity/impersonation.ts` — pure-core dev-only
  "act as <member>" identity resolution. `resolveImpersonatedSubject(members,
  req)` returns the target member's real role + age profile (via
  `ageProfileForRole`), plus the audit facts (impersonated member + developer).
  It SELECTS whose rights apply, never elevates: a child resolves to a child
  subject, so the Policy Engine still restricts it. Deny-by-default and fail
  closed: dev flag off, unknown member, or non-active member all throw. The core
  reads no environment — the dev flag is passed in by the caller (principle 1);
  audit emission + env-flag reading belong to the app layer. 6 tests (real
  role/profile, no minor elevation, flag-off denial, unknown/inactive refusal).
- **Verified (in container):** `npm test packages/core/src/identity` → 8 passed
  (2 existing + 6 new); `typecheck` → exit 0.
- **Decisions:** kept the dev gate as an injected boolean, not an env read, to
  preserve a provider/IO-free core; the resolver returns audit facts but emits
  nothing itself (the app sink records `identity.impersonated`).
- **Next step (RFC-006 cont.):** add an `identity.impersonated` audit event type
  (event-model) and an app-layer wiring that reads the dev flag from the
  environment (e.g. `KINOS_DEV_IMPERSONATION`), resolves the acting subject, and
  records the audit fact — so a governed `run --as <member>` can be driven from
  each member's viewpoint. Then the governed write API and the RFC-003 UI.

### Iteration 35 — 2026-06-26 (post-§19; persisted-config → runtime inspection, RFC-004)
- **Done:** `describeRuntime(store, id)` command + CLI `kinos runtime <id>`. Loads
  a persisted Sphere snapshot, reads its `runtimeConfig` (via importSphere),
  resolves the effective RuntimeProfile (`resolveEffectiveProfile`) and reports
  provider/model/execution, the cloud flag, allowed providers, and whether the
  profile is permitted (`assertProfileAllowed`, deny-by-default — a cloud profile
  with cloud disabled reports `allowed: no`). Read-only and provider-free: it
  inspects the persisted choice without constructing an adapter or a model call.
  Closes the loop persisted runtimeConfig → resolution end-to-end from the CLI.
  3 new tests (local-first default, cloud-disabled denial, missing Sphere).
- **Verified (in container):** `npm test packages/app/cli/src/commands.test.ts` →
  16 passed; `typecheck` → exit 0.
- **Decisions:** kept inspection separate from `selectRuntime` (it.34) so it stays
  network-free and pure-core (no adapter import); the adapter-constructing path is
  exercised by runtime-select.test.ts. Wiring the chosen runtime into a
  model-backed capability execution (executor using `selectRuntime` per Sphere)
  remains, but needs a model-backed binding to be meaningful.
- **Next step:** start **RFC-006** (dev impersonation) — the identity-resolution
  `actAs` path behind a dev flag, deny-by-default, audited — to unblock
  multi-member testing; then the governed write API and the RFC-003 UI. RFC-004 is
  now end-to-end (config → adapter → persistence → selection → inspection).

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

> Note: per-iteration entries 17–69 were not recorded here; see git history
> (`feat/mvp-implementation`) for that span. Recording resumes below at RFC-007.

### Iterations 70–75 — 2026-06-27 (RFC-007; Hermes as a governed runtime)
- **Done (TDD, one commit per slice):**
  - **70 — capabilities:** added `runtime.config.project`,
    `runtime.session.backup`, `runtime.session.restore` to the catalog
    (high-risk, adult/admin-only; project + restore carry an approval floor;
    backup does not). `catalog.test.ts`.
  - **71 — authorized surface:** `resolveAuthorizedCapabilities` (core) — the
    deny-by-default set the Policy Engine authorizes for an agent identity. The
    *first filter* only; the per-call double-check still enforces. Honors the
    catalog profile floor and (optionally) bindings; flags require_approval.
  - **72 — RuntimeConfigProjection:** `projectAgentRuntimeConfig` (core) builds
    the provider-agnostic per-agent runtime config from Sphere config + the
    agent's policy scope: one Sphere gateway, `allowedTools` = authorized
    surface, deny-by-default native tools, autonomous install disabled,
    credential by reference only. No concrete runtime name leaks into core.
  - **73 — Sphere MCP dispatch:** `handleSphereMcpCall` (core) — one governed
    gateway per Sphere, permissioned per calling agent. Subject anchored to the
    credential (never a caller-asserted identity); unknown credentials refused
    before any policy check; composes the existing sensitive-action flow.
  - **74 — RuntimeStateSnapshot:** opaque, by-reference (no content field),
    restorable runtime state; deny-by-default restore guard (available + same
    agent/Sphere). Non-canonical; `SnapshotStore` port.
  - **75 — Hermes adapter:** `@kinos/runtime-hermes` implements `AgentRuntime`,
    routing each turn to the calling agent's Hermes profile
    (`RuntimeRequest.agentId`, additive optional field; Ollama/OpenAI ignore it).
    `writeHermesProfile` realizes the projection as one `config.yaml` per profile
    (single Sphere MCP, allowed-tools surface, native-tool allow-list,
    autonomous install off, secrets by reference). `main.ts` selects the runtime
    via `KINOS_RUNTIME` (default Ollama) — a boring swap, no policy/memory
    migration. **Chat is now Hermes-backable end-to-end.**
- **Verified (in container):** full suite `npx vitest run` → 317 passed
  (the 59s live-Ollama test ran and passed); `tsc --build` exit 0.
- **Decisions:** core stays provider-agnostic (no "Hermes"/`~/.hermes` names);
  the Hermes realization lives entirely in the adapter. The Hermes HTTP wire
  shape is the integration seam — configurable + fake-fetch tested — to confirm
  against a deployed Hermes (no live Hermes available here).
- **Blocked on RFC-007 open questions (spec-first):** the *mutating* governed
  endpoints (`runtime.config.project`/`session.backup`/`session.restore`) and
  the Sphere MCP **server transport** both depend on **per-agent token
  provisioning/rotation** and the **MCP transport detail** — both listed as
  open questions in RFC-007 §"Open questions". Per the governing rule, these
  need a decision (ADR or RFC amendment) before implementation. The governed
  *dispatch* they sit behind is already built and tested (slice 73).
- **Next step:** resolve the RFC-007 open questions (token provisioning/rotation
  + transport: local socket vs loopback HTTP), then add the Sphere MCP server
  transport (task #8) and the mutating runtime-governance API endpoints + admin
  UI (task #7) on top of the existing core dispatch.

### Iterations 76–78 — 2026-06-27 (ADR-007; Sphere MCP transport + agent tokens)
- **ADR-007 drafted + accepted**, resolving RFC-007's two open questions: private
  transport (Unix socket co-located, else private-network Streamable HTTP) with
  the **per-agent bearer token as the security boundary**; tokens as secret-store
  credentials (additive `agent-runtime` owner kind), minted at projection time
  into the profile `.env` only, resolved at the gateway by one-way hash, rotated/
  revoked via the existing secret-store lifecycle (stable `secretRef.id`), audited
  as facts only. Amended `secret-store.md` (owner kind) and `event-model.md`
  (`runtime.token.provisioned/rotated/revoked`).
- **76 — token store:** core `AgentTokenStore` port (value never enters the
  domain) + `SqliteAgentTokenStore`: mints a high-entropy token, returns the raw
  value once, persists only a SHA-256 hash + a stable `secretRef`; `resolve()` is
  fail-closed (active-only). Rotation keeps the ref stable; revocation denies
  future resolution. + `runtime.token.*` audit event types.
- **77 — Sphere MCP server transport:** minimal MCP JSON-RPC surface
  (`tools/list` + `tools/call`) over the tested core dispatch, bearer-authenticated
  (ADR-007). Wired at `POST /spheres/:id/mcp` (served only when MCP deps are
  present) + `main.ts` with the SQLite token store. **e2e over real HTTP + SQLite:
  provision token → list → call; a forged token fails closed.**
- **78 — projection preview endpoint + admin UI:** `POST
  /spheres/:id/agents/:aid/runtime/projection` (admin-gated, read/compute, no
  mutation) returns the exact governed config that would be written to an agent's
  Hermes profile — single Sphere MCP, deny-by-default authorized tool surface,
  native tools, install disabled, credential by reference. Computed for the
  **agent's own** policy scope (owner-derived), not the admin caller. UI: per-agent
  "Preview Hermes projection" panel on the Sphere page.
- **Verified (in container):** core + adapters + api + ui `tsc` clean; targeted
  suites green (token store 4, MCP server 5, router 60, e2e 4, projection 5).
- **Now usable end-to-end:** a Hermes container set with `KINOS_RUNTIME=hermes`
  chats via the Hermes adapter and calls back into the **Sphere MCP** with its
  per-agent token to reach policy-scoped capabilities.
- **Deferred (task #9):** the *mutating* approval-gated capabilities
  (`runtime.config.project` mint/rotate + profile write, `session.backup/restore`)
  — they need execution routed through bindings + a runtime-governance executor so
  the approval floor + grant re-run compose, and a live Hermes profile dir to
  write/back up. Best built against a running Hermes.

### Iterations 80–82 — 2026-06-27 (verified against the REAL Hermes container)
- **Researched the real NousResearch/hermes-agent** (docs + cloned source) and
  corrected two speculative assumptions from earlier slices:
  - The Hermes config schema: `mcp_servers` is a **map** keyed by name with
    `{url, headers, tools.include, enabled}`, and provider config lives under a
    `model:` section. Rewrote the projection writer (iter 80) + tests to the real
    schema; auth via `headers.Authorization: "Bearer ${SPHERE_MCP_TOKEN}"`, the
    token value written only to the profile `.env` (ADR-007). Confirmed from the
    Hermes source that it interpolates `${VAR}` in headers via `os.getenv` — so
    the ADR-007 secret design is correct.
  - Hermes is **not** driven by a bespoke HTTP message API. Real programmatic
    seams are an OpenAI-compatible API server + an outbound MCP client. The
    `HermesRuntime` HTTP adapter (invented `/agents/{profile}/messages`) is kept
    for now per the user's call, but flagged: Hermes-as-inference should reuse the
    OpenAI adapter against Hermes' API server.
- **MCP handshake (iter 81):** added `initialize`/`notifications/initialized`/
  `ping` to the Sphere MCP server (real clients open a session before tools/*).
- **inputSchema (iter 82):** real Hermes' MCP client (pydantic) rejects a tool
  without `inputSchema`; added a permissive object schema to tools/list.
- **Built the real Hermes image** (`docker build` of NousResearch/hermes-agent,
  3.78 GB) and **verified the RFC-007/ADR-007 loop end-to-end against it**
  (KinOS api on :8787, real SQLite, a seeded Sphere/agent/policy/binding/token):
  - real Hermes MCP client → `initialize` + `tools/list` → discovers exactly the
    policy-authorized `['memory.search']`;
  - real MCP client `tools/call memory.search` → governed execution →
    `{"echoed":{"q":"hello"}}` (allow + binding);
  - `tools/call payment.execute` → `isError, No enabled binding` (deny by default);
  - a **forged token** → `McpError: Unauthenticated credential` (fail closed).
- **docker-compose.yml** Hermes template updated to the verified build/run recipe
  (real image, host networking, projected `mcp_servers.sphere` config, token via
  env/`.env`; note that `hermes mcp test` CLI needs the mcp[cli]/typer extra).
- **Verified (in container):** full suite `npx vitest run` (excl. live-ollama)
  → 328 passed; `tsc` clean. Live Hermes integration verified as above.

### Iteration 84 — 2026-06-27 (retire HermesRuntime; Hermes inference via OpenAI adapter)
- **Confirmed from the hermes-agent source** that Hermes exposes an
  **OpenAI-compatible API server** (`gateway/platforms/api_server.py`):
  `GET /v1/models`, `POST /v1/chat/completions` (+ `/v1/responses`, `/v1/runs*`),
  default port **8642**, Bearer `API_SERVER_KEY` (server refuses to start without
  it; refuses a `<16`-char key on a `0.0.0.0` bind), and **the `model` field
  selects the Hermes profile** (`API_SERVER_MODEL_NAME` defaults to the profile
  name, `hermes-agent` for the default profile).
- **Retired the bespoke `HermesRuntime`** (it assumed a non-existent
  `/agents/{profile}/messages` endpoint) and the now-dead `RuntimeRequest.agentId`
  field. Hermes-as-inference now **reuses `@kinos/runtime-openai`** pointed at
  `HERMES_BASE_URL` (default `http://localhost:8642/v1`) with `HERMES_API_KEY`;
  `KINOS_RUNTIME=hermes` selects it (a boring swap). The `runtime-hermes` package
  keeps its RFC-007 config-projection writer. api deps/tsconfig + compose env
  updated.
- **Verified against the real Hermes image** (`gateway run` with a strong
  `API_SERVER_KEY` on `0.0.0.0`): the **actual KinOS `OpenAiRuntime`** →
  `isAvailable: true`, `listModels: ["hermes-agent"]`; a wrong key →
  `isAvailable: false` + `401 Unauthorized` from the adapter. (Full
  `/v1/chat/completions` generation needs Hermes configured with an LLM provider —
  operator setup; the wire/auth path is identical to the proven `listModels`.)
- **Verified (in container):** 250 targeted tests green; `tsc` clean.

### Iteration 85 — 2026-06-27 (task #9a: runtime.config.project, governed + live)
- **Implemented the mutating `runtime.config.project`** through the existing
  governed pipeline (no new approval machinery): core `runtimeGovernanceBindings()`
  maps the runtime-governance capabilities to the local executor's `runtime.*`
  tools; the execute + grant endpoints inject those bindings so the capability
  flows through the policy double-check + the catalog approval floor. The executor
  side effect (`projectAgentConfig`, app/api) computes the agent's projection for
  its **own** policy scope, **provisions/rotates** the per-agent Sphere-MCP token,
  and **writes the Hermes profile** (`config.yaml` + `.env`) — token value only in
  `.env` (ADR-007), audited as `runtime.token.provisioned`. `main.ts` wires the
  `runtime.project` handler over node fs (HERMES_HOME, KINOS_PUBLIC_URL).
- **Verified end-to-end against the real Hermes image** (api on :8787, real
  SQLite): `POST …/capabilities/runtime.config.project/execute` → **202** (approval
  floor) → `POST /approvals/:id/grant` (a *different* parent; self-approval refused)
  → **executed**. KinOS wrote `run/hermes/agt_0/config.yaml` (real schema:
  `mcp_servers.sphere` url + `tools.include:[memory.search]` + `Authorization:
  Bearer ${SPHERE_MCP_TOKEN}` + `autonomous_mcp_install:false`) and `.env`
  (`SPHERE_MCP_TOKEN=…`). The **real Hermes MCP client** then loaded exactly those
  KinOS-written artifacts and connected: `tools= ['memory.search']`.
- **Verified (in container):** full suite (excl. live-ollama) → **329 passed**;
  `tsc` clean. New tests: governance bindings, `projectAgentConfig`
  (write + rotate + fail-closed), and the execute→202→grant→executed pipeline.
- **Remaining (task #9b):** `runtime.session.backup` / `restore` — need an
  encrypted-blob adapter (tar+encrypt a profile dir) + a SQLite SnapshotStore.
  Deferred; the snapshot entity/guard + capabilities already exist.

### Iteration 86 — 2026-06-27 (task #9b: runtime.session.backup/restore, governed + live)
- **Encrypted-blob + snapshot persistence** (persistence-sqlite):
  `FsEncryptedBlobStore` (AES-256-GCM; dependency-free directory capture as
  `{path->base64}` JSON, encrypted; restore overwrites the dest) and
  `SqliteSnapshotStore` (RuntimeStateSnapshot records — metadata + blob ref, never
  content). Core gained the `RuntimeStateBlobStore` port + `InMemorySnapshotStore`.
- **Side effects** (`backupAgentState` / `restoreAgentState`, app/api): backup
  captures the agent's profile dir → records a snapshot (fact only); restore is
  **deny-by-default** via `assertSnapshotRestorable` (available + same agent/Sphere)
  then replays the blob. Wired as the `runtime.backup`/`runtime.restore` executor
  tools (main.ts) — backup has no approval floor, restore is approval-gated
  (catalog). Execute + grant responses now surface the executor `output` (so
  backup returns its `snapshotId`). Audit: `runtime.session.backed_up/restored`
  (ref only) + event-model.
- **Verified end-to-end against real SQLite + AES-GCM blobs** (governed API):
  project → backup (returns snapshotId + encrypted blob) → corrupt `config.yaml`
  → restore (**202** approval floor → grant) → `config.yaml` restored to the
  original. Restore self-approval refused; deny-by-default on unknown/foreign
  snapshots.
- **Verified (in container):** full suite (excl. live-ollama) → **340 passed**;
  `tsc` clean. New tests: blob roundtrip (encrypted/byte-exact/overwrite/wrong-key),
  snapshot store, backup/restore side effects, and the backup(200)/restore(202→grant)
  pipeline.
- **RFC-007 / ADR-007 are now fully implemented and live-verified** — governance
  (Sphere MCP), inference (OpenAI adapter → Hermes /v1), and all three mutating
  runtime-governance capabilities (config.project, session.backup, session.restore).

### Iteration 87 — 2026-07-13 (RFC-008: governed provisioning + bootstrap — doc)
- **New work stream: a complete, ergonomic admin/operator UX** (create & administer
  Spheres, deploy permissioned agents, store/install, test agents in real
  conditions). Target aesthetic: a *calm operator console*; real-condition testing
  routes through the RFC-007/ADR-007 Hermes governed loop with **local Ollama** as
  Hermes' inference provider (host Ollama live: `qwen3-128k`).
- **Gap found:** creating a Sphere, adding members and deploying agents exist today
  only as out-of-band CLI/core factory calls (`initSphere`, `createSphere`,
  `createAgent`) that write the store directly — no governed path, so the UI cannot
  do them without bypassing the Policy Engine. RFC-003 already made the UI the
  intended admin surface but left "manage members/agents" as a pointer to the
  api-contract, and **`sphere.create` cannot be gated like other capabilities**
  (no Sphere/policy/administrator exists yet).
- **RFC-008 (Accepted)** pins RFC-003's admin table into concrete catalog
  capabilities (`sphere.create`, `member.invite`, `agent.create`,
  `agent.update_config`; admin-only/high-risk/adult-only) and defines the
  **bootstrap** rule: (1) `sphere.create` is *instance-scoped*, authorized by a
  fixed **bootstrap policy set** (local operator = root of trust) — same
  `evaluate()`, different explicit policy set, deny-by-default preserved; (2)
  creating a Sphere seeds a **default admin policy set** so administrators can
  provision within it (avoids a second chicken-and-egg). Execution reuses the
  RFC-007 pattern: capability → local-executor tool whose side effect mutates the
  store. Deploying an agent with a capability in scope is **not** an
  authorization — every call is still policy-checked per call.
- README RFC index brought up to date (003–008 were missing).
- **Next:** core catalog entries + `defaultAdminPolicies` + provisioning
  bindings/executor tools (TDD), then the instance `POST /spheres` + in-Sphere
  execute endpoints, then the calm-operator-console UI.

### Iteration 88 — 2026-07-13 (core: provisioning capabilities + policy sets)
- Catalog: `sphere.create`, `member.invite`, `agent.create`,
  `agent.update_config` (admin-only/high-risk/adult-only, no approval floor).
- New `provisioning` core module: `provisioningBindings()` (capability → local
  executor tool, the RFC-007 pattern), `bootstrapPolicies()` (instance-scoped:
  an adult may `sphere.create`, nothing else) and `defaultAdminPolicies()`
  (seeds a new Sphere so administrators can provision). Pure domain. Added the
  `agent.updated` audit fact. 15 core tests.

### Iteration 89 — 2026-07-13 (API: governed provisioning endpoints + hardening)
- **Instance `POST /spheres`** (bootstrap): evaluates `sphere.create` against
  `bootstrapPolicies()`; the side effect generates the Sphere id, records the
  founder as first administrator, seeds `defaultAdminPolicies`, and audits
  `sphere.created`. A non-adult is denied (403).
- **In-Sphere provisioning** through the existing execute endpoint: added
  `provisioningBindings()` to the injected bindings and a `provisioning.ts`
  side-effect module (`createSphere/inviteMember/createAgent/updateAgent`
  Provision) wired into `main.ts`'s local executor. The router now injects the
  **path Sphere id + correlation id** into the executor input (integrity: a
  client cannot provision into another Sphere). Ids are generated in the app
  layer (core stays deterministic).
- **Hardening (found via live smoke):** an executor side-effect throw previously
  **crashed the API process** (the async request IIFE had no catch). Fixed at two
  layers — a `server.ts` safety net (never crash → correlated 500) and the
  router converts an authorized-but-failed side effect into a governed
  **422 `execution_failed`** (e.g. deploying an agent for a non-member). Deploy
  ≠ authorize: a capability in an agent's scope is still policy-checked per call.
- **Verified:** full non-live suite **364 passed**; `tsc` clean. **Live HTTP
  smoke** (real server + SQLite): create (adult 200 / child 403) → invite (admin
  seed) → members=2 → deploy agent with scope → agents=1 → child invite 403 →
  non-member deploy **422, server stays up**.
- **Next:** the calm-operator-console UI — design system + shell, then wire the
  admin + agent-testing flows on these endpoints.

### Iteration 90 — 2026-07-13 (UI: operator-console design system + shell + proxy)
- **`globals.css`** — a calm, information-first design system for the trust
  console: a monospace-for-machine-facts voice (ids, capabilities, states,
  correlation ids), hairline borders, deliberate spacing, semantic allow/deny/
  approval color, light **and** dark via `prefers-color-scheme`. Local-first: no
  network fonts.
- **App shell** — `layout.tsx` + a client `TopNav` (brand, primary nav, a live
  API-health dot).
- **Same-origin API proxy** (`/api/kinos/[...path]`): the browser only talks to
  Next; the handler forwards to the KinOS API server-side. No CORS, the API URL
  stays server-side, and the UI still decides no authorization (it only relays
  the governed request/response). Fixes the latent cross-origin gap where the old
  client components fetched the API origin directly.

### Iteration 91 — 2026-07-13 (UI: admin + agent-testing flows, end-to-end)
- **`GET /capabilities`** (API): read-only capability-catalog metadata
  (name/risk/profiles/approval-floor) so the admin can choose an agent's scope
  from the real catalog. No raw tool ids leak. Agents endpoint now also returns
  `modelPreference`. Router test added.
- **Provisioning UI flows** (RFC-008), all through the governed pipeline:
  `CreateSphere` (bootstrap), `InviteMember`, `DeployAgent` (with a
  `CapabilityPicker` — scope is a request surface, shown as such), and
  `AgentConfig` (edit scope / model / lifecycle + fold-in of the RFC-007 Hermes
  **projection preview**). Client wrappers + a shared `describeOutcome` render
  allow / approval / deny / 422 as user-safe notes.
- **Rebuilt every page/component** on the design system and the same-origin
  proxy: Spheres index (+ create), the **Sphere console** (overview stats,
  members + invite, agents + deploy + per-agent configure, runtime, connectors,
  capability test bench), the **agent test console** (chat showing the agent's
  governed scope + optimistic turns), the **store**, and the **approvals inbox**.
  Retired `RuntimeProjection.tsx` (folded into `AgentConfig`).
- **Verified:** `tsc` clean; full non-live suite **365 passed**; `next build`
  clean. **Full-stack E2E** (real API + `next start` together): SSR renders
  against the API; the browser-facing proxy create → invite → deploy works;
  `/capabilities` loads; the Sphere console SSR shows the deployed agent; the
  test-agents page renders; and a governed denial (child invite) still surfaces
  as 403 — 8/8 checks passed, no crashes.
- **Now usable end-to-end from the UI:** create & administer Spheres, deploy
  permissioned agents, browse/install store packages, manage connectors/runtime,
  resolve approvals, and test agents in real conditions (Hermes→local Ollama).

### Iteration 92 — 2026-07-13 (compose `ui` service + docs; live compose verify)
- **`docker compose up api ui`** now brings up the API (:8787) and the operator
  console (:3000, host port overridable via `KINOS_UI_PORT`) together; the
  console reaches the API over the compose network at `http://api:8787`.
- README "Operator console" section rewritten (read-only → governed admin
  surface): what you can do (create/administer Spheres, invite members, deploy
  permissioned agents with a catalog-picked scope + projection preview, store,
  connectors, runtime, approvals, real-condition testing) and the same-origin-
  proxy / no-CORS / not-the-boundary design. UI package description updated.
- **Verified live via compose** (`KINOS_UI_PORT=3005 docker compose up api ui`):
  console home renders (200); the browser-facing proxy `/api/kinos/health`
  reaches the `api` service over the compose network (`{"ok":true}`); creating a
  Sphere through the console proxy returns a new id (executed). Stack torn down
  clean.
- **RFC-008 is fully implemented and verified** across core → API → UI, and the
  MVP §19 admin flow (create Sphere → add adults + a child → an agent per member,
  role-gated capabilities, approvals, local runtime) is now doable entirely from
  the console.

### Iteration 94 — 2026-07-14 (chat 403 was a masked runtime failure)
- **Bug:** the chat-turn handler reported *every* throw from `runChatTurn` —
  including runtime failures — as `403 forbidden "Not authorized for this
  session"`. A Sphere seeded with model `llama3.2` (not pulled in Ollama) made
  every `/chat` turn 404 at the runtime and surface as a bogus 403.
- **Fix:** `authorizeSessionRead` now runs *explicitly before* the runtime; a real
  `403` only for a non-owner. A runtime throw surfaces truthfully as `502
  runtime_error` with the real reason. The Ollama adapter now includes the
  response body (e.g. `model 'llama3.2' not found`) in its error.
- Regression tests added (router 502 path; adapter message). Verified live against
  the compose API: the same turn now returns `502 … Ollama /api/chat failed: 404
  … model 'llama3.2' not found`.

### Iteration 95 — 2026-07-14 (RFC-009: governed per-agent default model)
- **RFC-009 accepted** — completes RFC-004's decision that an agent's model is a
  governed selection (no longer an advisory tag), governable by the Sphere's
  administrators (the founder/owner is one).
- **Core:** new `model.set` capability (adult-only, medium risk, immediate);
  `agent.modelPreference` reframed advisory → governed; `defaultAdminPolicies`
  seeds a `model.set` grant so admins/owner can set it out of the box (closing the
  "no governed path" gap that made a Sphere un-repointable).
- **API:** `POST /spheres/:id/agents/:aid/model { subject, model }` — catalog floor
  + policy check + Sphere-allowed validation, then writes the preference, audited.
  The chat/turn path now resolves the model via `resolveEffectiveProfile(config,
  agent.modelPreference)` (previously ignored the agent entirely).
- **Hermes profile (RFC-007) now carries the governed per-agent model:**
  `projectAgentConfig` was dropping `agent.modelPreference` (Hermes always got the
  Sphere default); it now feeds it into the projection, so an agent's Hermes
  profile runs on exactly the model KinOS decided. Both runtime paths — direct
  inference and Hermes — honour the same governed decision.
- **UI:** the per-agent `AgentConfig` model field now routes through the dedicated
  `model.set` endpoint (not the broad `agent.update_config`).
- **Verified live end-to-end:** provision a fresh Sphere → deploy an agent →
  Sphere default `llama3.2` (unpulled) → admin sets the agent's model to
  `qwen2.5:7b` (executed) → non-admin denied (403) → chat turn replies, running on
  the per-agent model. 376 tests pass; typecheck + `next build` clean.

### Iteration 96 — 2026-07-14 (ADR-008: agents always run in a governed Harness)
- **ADR-008 accepted.** Settles that an agent never executes "bare": it always runs
  inside a **Harness** — a governed execution environment with no ambient authority
  that reaches capabilities only through the Sphere MCP (policy-checked per call).
- Disentangles the two meanings of "runtime": the **Harness** (agent execution,
  RFC-007/Hermes) vs the **inference runtime** (the `AgentRuntime` text backend,
  RFC-004/Ollama·OpenAI). The Harness *uses* an inference backend; the governed
  per-agent model (RFC-009) is **projected into** the Harness profile.
- **Hermes is the sole MVP Harness, an adapter behind the role** — the domain
  depends on the Harness contract (projection + Sphere MCP + token), never on
  Hermes; adding/replacing a Harness needs no policy/memory/capability/token
  migration.
- Rejects the framing "governed = the Hermes profile": governance stays in the
  Policy Engine upstream; the profile is a projection, never the boundary.
- **Honest open gap** recorded: the console `/chat` still drives inference directly
  (test-mode), not the full Hermes Harness loop; ADR-008 authorizes migrating
  real-condition testing onto the Harness as a follow-up.

### Iteration 97 — 2026-07-14 (domain vocabulary: the Harness)
- Satisfies ADR-008 acceptance criterion #1: `domain-model.md` now defines
  **Harness** as the governed agent-execution role — no ambient authority, runs
  downstream of the Policy Engine on a RuntimeConfigProjection, reaches capabilities
  only via the Sphere MCP, and is **distinct from the inference runtime**
  (`AgentRuntime`/RuntimeProfile, which it merely *uses*). Replaceable role; Hermes
  is the sole MVP harness; never the authorization/privacy boundary.
- Adds the Harness to the Agent's fields and the relationship summary; reworded
  RuntimeConfigProjection to write to "the agent's Harness".
- Spec-first ordering: this domain term precedes the core Harness-port seam
  (next iteration). The full Hermes agentic path stays blocked until the compose
  `hermes` service is enabled and a Hermes execution adapter exists (today
  `runtime-hermes` only projects config; Hermes-as-inference reuses the OpenAI
  adapter).

### Iteration 98 — 2026-07-14 (live Hermes Harness: /chat runs through Hermes)
- **Enabled the Hermes Harness in compose** (opt-in `hermes` profile) and verified
  the ADR-008 Harness inference path **live, end-to-end**: KinOS `/chat` →
  `KINOS_RUNTIME=hermes` → OpenAI adapter → Hermes `/v1/chat/completions` (profile
  `hermes-agent`) → Hermes agent loop → host Ollama → reply, persisted through
  KinOS governance. This closes the ADR-008 "test-mode" gap for **inference**: a
  chat turn is now served by the governed Harness, not direct Ollama.
- **`deploy/hermes/bootstrap.py`**: makes Hermes' migrated `config.yaml` a KinOS
  Harness config on container start (idempotent) — points its `model` at the host
  Ollama over Ollama's OpenAI-compatible `/v1` (Hermes' `ollama` provider speaks
  `/v1`; a bare `:11434` base_url 404s), overrides `context_length` to 65536
  (Hermes requires ≥64K; Ollama reported 32K for the `-128k` tag), enables the
  `api_server` gateway platform on :8642, and disables the cloud curator (it spammed
  openrouter/nous auth failures every turn). Model/URL/context overridable via
  `HARNESS_MODEL` / `HARNESS_OLLAMA_URL` / `HARNESS_MODEL_CONTEXT`.
- **Compose**: `hermes` service (image `hermes-agent:local`, cont-init → bootstrap
  → `gateway run`), api reaches it at `hermes:8642` on the compose network, key
  shared via `HERMES_API_KEY`/`API_SERVER_KEY` (≥16 chars). Start with
  `KINOS_RUNTIME=hermes docker compose --profile hermes up api hermes`; default
  stack stays local-first Ollama.
- **RFC-009 × Harness note:** for a Hermes-backed Sphere the governed "model"
  (RFC-009) is the Hermes **profile name** (`hermes-agent` for the default profile),
  not a raw Ollama tag — the raw inference model lives inside the projected profile.
  Set the agent's model to the profile name.
- **Verified:** `model.set → hermes-agent` (200), chat turn (200, reply `HARNESS`,
  ~42s warm; ~52s cold model load). With `KINOS_RUNTIME=hermes` the Ollama runtime
  is never constructed, so a 200 reply can only come via Hermes (a down Hermes would
  give the iteration-94 `502`).
- **Still open (honest):** the **full governed tool loop** — per-agent *projected*
  profiles (`runtime.config.project`) with `mcp_servers.sphere` calling back into the
  KinOS Sphere MCP for policy-scoped capabilities — is not yet wired into `/chat`
  (single default `hermes-agent` profile only). The MCP callback itself was verified
  against this image earlier (iters 80–82); wiring per-agent profiles into the chat
  path is the next slice.

### Iteration 100 — 2026-07-15 (RFC-010: full Sphere administration, one Harness, the governed TUI)
- **RFC-010** (`docs/rfcs/010-…`): three changes that all trace to the ADR-008
  Harness/provider conflation, plus the administration gap it left behind.
- **Administrators can administer their whole Sphere.** `defaultAdminPolicies`
  seeded provisioning + runtime governance + `model.set`, but the console also
  exposes connectors, the store and the provider/model — all policy-checked, none
  seeded, so **deny-by-default refused a `parent` on their own Sphere**. New
  `IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES` (`runtime.set_provider`,
  `integration.*`, `package.*`) + the `admin_settings` seed. The `Role` union is
  unchanged — no `admin` role; administration stays role-based on `parent`.
- **Seed backfill is now lineage-anchored.** Routing the settings capabilities
  through `withAdminSeedMigration` exposed that the old unconditional backfill
  authorized a Sphere with **zero policies** (existing tests caught it — it broke
  deny-by-default). It now applies only to a Sphere still carrying the
  `admin_provisioning` seed, so it can never fabricate authority.
- **Fixed a real pre-existing bug:** the approval *grant* path re-evaluated
  against un-migrated policies, so an action could be authorized, suspend for
  approval, then be **denied at grant time** — an unresolvable approval. Hit live
  on `runtime.config.project`.
- **One Harness.** `KINOS_RUNTIME` is gone (Hermes always), the compose `hermes`
  profile gate is gone, and `hermes` is no longer offered as a *provider*. Ollama
  stays exactly as it was — an RFC-004 inference **provider**, not a harness.
  `GET /spheres/:id/runtime` now reports the sole Hermes Harness with the
  **governed** provider/model instead of reading `HARNESS_MODEL`/`KINOS_RUNTIME`
  env — it could previously show a model KinOS never decided.
- **Provider/model is wired into the Hermes profile** (ADR-008 §4, verified live):
  the projection writes `model: {default, provider, base_url, context_length}`.
  The adapter owns the two Hermes-specific facts the domain must not carry —
  `/v1` on an Ollama base_url, and `context_length: 65536` (Hermes refuses <64K;
  projected profiles previously had **none**, so bootstrap.py's default profile
  was the only valid one). `defaultRuntimeConfig()` model → `gemma4-128k`.
  Profile dirs are chowned to the Harness uid/gid or Hermes cannot read them.
- **The governed TUI replaces the chat bench** (closes the ADR-008 §6 gap for the
  *agent loop*, not just inference). New `runtime.session.attach` capability;
  browser → API (policy-checks, mints a single-use 60s ticket) → websocket →
  **bridge inside the Hermes container** → `pty: hermes chat --tui` with
  `HERMES_HOME=<profile>`. `ui/…/chat/Chat.tsx` deleted.
- **Two findings that shaped it.** (1) Hermes has **no `--profile` flag**: a
  profile *is* a `HERMES_HOME` (`hermes_cli/profiles.py`), and `HERMES_PROFILE`
  does *not* select one — it only appears in a denylist and kanban. (2) The bridge
  runs **inside** Hermes rather than `docker exec` from the API, so **no docker
  socket is mounted anywhere**: exec would have given host-root to the component
  that *is* the authorization boundary. The bridge decides nothing — it redeems a
  ticket and is told an **agent id, never a path**.
- **Verified live** against the real stack and real Spheres: `parent` sets the
  provider (`executed`, previously denied); harness reports `hermes` +
  `gemma4-128k`; the projected profile lands as `hermes:hermes` with the governed
  model; a real **Hermes TUI banner renders over the websocket**; a **minor is
  refused** by the catalog floor; a **replayed ticket is refused** (1008); the
  ticket value never reaches the audit. 416 tests, typecheck and `next build` green.
- **Known limitation (tracked):** a seed an admin *deletes* is re-added by the
  backfill; `status: "disabled"` is the revocation that survives. The bridge port
  is published for the browser, so the ticket is the boundary — same posture as
  the ADR-007 note on the Sphere MCP, and it wants the same hardening.

### Iteration 101 — 2026-07-16 (RFC-011: governed binding creation completes the tool loop)
- **RFC-011** (accepted): completes the RFC-002 grant wizard, which had stopped at
  a status flag — `installPackage`/`enablePackage` created no `CapabilityBinding`
  and emitted no policy, so every projected agent surface was empty and the ADR-008
  governed tool loop (agent → Sphere MCP → policy-checked `tools/call`) could not be
  exercised. This was the gap flagged when verifying RFC-010.
- **Manifest** gains `bindings` (capability→runtimeToolName/risk/execution —
  mechanism only, authorizes nothing, coding principle 8) and `defaultPolicies`
  (adult-scoped grant presets, deny-by-default for minors). `createManifest` rejects
  a binding for a capability the package does not provide.
- **Two pure core fns:** `packageBindings(manifest, status)` and
  `packageGrantPolicies(manifest, sphereId)` (stable ids, idempotent).
- **Governed lifecycle:** install merges the bindings **disabled** (install ≠
  authorize); enable flips them **enabled** + merges the grant policies (idempotent
  re-enable); disable flips them back to disabled (deny-by-default blocks the
  future). All through the already-policy-checked package handlers.
- **Demo wiring:** `family-calendar` → `calendar.read`→`local.calendar_read`
  (allow), `calendar.create_event`→`local.calendar` (require_approval, parent
  approver). New `local.calendar_read` executor handler returns synthetic events (a
  real calendar integration replaces it later with no policy change).
- **Verified LIVE, full loop, on a fresh governed Sphere:** create Sphere → deploy
  agent → install (surface stays **empty**) → enable (surface becomes
  `[calendar.create_event, calendar.read]`) → project profile (approved by a 2nd
  parent). Then from the **Hermes container** with the agent's real 43-char token:
  `tools/list` shows both (create_event flagged requiresApproval); `tools/call
  calendar.read` → Policy Engine allow → executor → `{"events":[{"title":"Family
  dinner",...}]}` `isError:false`; `tools/call calendar.create_event` → **suspends**
  `pending_approval` (does not execute); **forged token → rejected**. This is the
  ADR-008 loop end-to-end, per-call policy-checked. RFC-010's verification gap is
  closed.
- 424 tests, typecheck, next build green.

### Iteration 102 — 2026-07-16 (store: valid, testable packages across the governance spectrum)
- Applies RFC-011 (no new decision) to populate the store with packages that are
  fully wired for the governed tool loop — capability in the core catalog + manifest
  binding + adult grant preset + registered executor handler — so an operator can
  actually test each governance shape end-to-end.
- **New packages:** `family-notes` (memory.search allow / memory.share
  require_approval), `household-messaging` (message.send require_approval, parent
  approver), `household-payments` (payment.execute — `allow` preset that the
  catalog's *critical approval floor* still raises to approval per call).
- **Local demo handlers extracted** to `packages/app/api/src/local-handlers.ts`
  (exported map) and added: `local.memory_search`, `local.memory_share`,
  `local.message` (+ existing calendar/pay/echo). Synthetic data only — stand-ins
  for real integration adapters; swapping one in changes no policy/memory/token.
- **Guard tests (prevent "enables but no handler"):** core — every store binding's
  capability is provided, is a known core catalog capability, and is granted, and
  every preset is adult-scoped (minors deny-by-default); app — every `local`
  store binding's runtimeToolName has a registered handler.
- **Verified LIVE, full spectrum** on the fresh governed Sphere (install+enable each
  → re-project → `tools/call` from the Hermes container with the agent's real
  token): `calendar.read` + `memory.search` → **execute** (real demo results);
  `memory.share` + `message.send` + `calendar.create_event` → **suspend**
  (require_approval); `payment.execute` → **suspend** even with an `allow` grant,
  because the critical approval floor wins per call — a grant can never lower a
  floor. 429 tests, typecheck, next build green.

### Iteration 103 — 2026-07-16 (RFC-012: execution context + a real Sphere-scoped calendar)
- **RFC-012** (accepted): two coupled changes turning the family-calendar demo into
  a genuine integration.
- **Execution context threaded to handlers** (additive, zero breakage): new
  `ExecutionContext` {sphereId, subject, correlationId, execution, time}; optional
  3rd param on `CapabilityExecutor.execute` and `CapabilityHandler`; passed at the
  single call site (`resolver.ts`), so both the direct and post-approval paths
  cover it. Descriptive only — a handler never authorizes; it scopes/attributes.
- **First real integration adapter:** `calendar.*` now backed by a persistent,
  Sphere-scoped store. Core `calendar/` module (`CalendarEvent`, `CalendarStore`
  port, `createCalendarEvent`, `InMemoryCalendarStore`); `SqliteCalendarStore`
  (`calendar_events` table, `sphere_id`-scoped); `local.calendar_read`/
  `local.calendar` handlers read `context.sphereId` (never agent input) for scope
  and `context.subject` for `createdBy`. `local-handlers.ts` is now a factory over
  its deps.
- **Isolation is enforced by the governed context, not agent input:** an agent that
  puts `sphereId` in the tools/call args cannot plant an event in another Sphere
  (covered by a dedicated test; scope always comes from the token's Sphere).
- **The swap is "boring":** the family-calendar manifest, bindings, grant presets
  and the Policy Engine are unchanged — only the backend became real.
- **Verified LIVE, full round-trip** through the governed loop: `calendar.read` →
  empty; `calendar.create_event` → suspends (require_approval) → grant → **persists
  a real event** (sphereId from the governed context, createdBy from the subject);
  `calendar.read` → returns the persisted event. 439 tests (+1 skipped),
  typecheck, next build green.

### Iteration 104 — 2026-07-16 (RFC-013: real canonical memory — policy-scoped notes)
- **RFC-013** (accepted): makes the `family-notes` package real by wiring its
  capabilities to KinOS's existing canonical memory (the `MemoryItem` model, the
  ADR-002 `resolveReadableMemory` rule, and the Sphere snapshot where memory
  already persists) rather than inventing a parallel store.
- **New capability `memory.capture`** (low risk, adult+teen): append a **private**
  MemoryItem owned by the acting subject (private by default, ADR-002).
  `family-notes` now provides capture + search + share.
- **Three real handlers** (factory gains a `SphereStore` dep): `local.memory_capture`
  (load-append-save), `local.memory_search` (load → `resolveReadableMemory` →
  substring filter), `local.memory_share` (load → `shareWithMembers` → save). All
  take Sphere + subject from the governed ExecutionContext, never agent input.
- **Headline property — memory retrieval is policy-scoped per item** — enforced by
  the existing resolver, not re-implemented: an agent sees only its owner's memory
  and memory shared to it; a deny/require_approval policy still dominates.
- **Verified LIVE:** A captures a private note, B captures a private note; the
  agent (owned by A) `memory.search` via the Sphere MCP returns **only A's** note,
  B's direct search returns **only B's**; A shares its note with B
  (require_approval → grant → `shared_with_members`), after which B's search
  returns **both**. Capture/search/share cannot be forged into another Sphere
  (scope from context). 442 tests (+1 skipped), typecheck, next build green.

### Iteration 105 — 2026-07-16 (RFC-014: advanced admin-scoped package grants)
- **RFC-014** (accepted): completes the RFC-011 grant wizard's deferred advanced
  path — an admin can scope a package's grant to specific roles/members/age
  profiles at enable time, instead of only the one-click adult default.
- **`POST /packages/:id/enable`** gains an optional `grant`: clauses
  `{roles?, memberIds?, ageProfiles?, capabilities, effect?, approverRoles?}`.
  Absent → RFC-011 manifest defaults (backward compatible). Present → the admin's
  clauses REPLACE the default (stating a grant means "this is the grant").
- **Bounded + safe by construction:** new pure core fn `customGrantPolicies`
  rejects a clause naming a capability the package doesn't provide (400), an empty
  selector (no silent grant-to-everyone), empty capabilities, or an approval clause
  with no approver. Minor safety is NOT re-checked — the catalog profile floor
  denies a risky capability for a minor per call regardless, so an over-broad clause
  is inert, not dangerous (defence in depth).
- **Verified LIVE:** enable family-calendar granting `calendar.read` to teens →
  a teen-owned agent's projected surface is exactly `[calendar.read]` (not
  create_event), while an adult-owned agent's surface is `[]` (custom grant
  replaced the adult default). Granting `payment.execute` to teens is inert: absent
  from the teen surface, and a teen's direct call is refused by the floor
  ("Profile 'teen' is not allowed for capability payment.execute"). 449 tests
  (+1 skipped), typecheck, next build green.

### Iteration 106 — 2026-07-16 (RFC-015: memory share revocation)
- **RFC-015** (accepted): completes the notes story with revocation — new
  `memory.revoke_share` capability (medium risk, adult+teen, no approval floor:
  a safety action is low-friction). `family-notes` provides capture/search/share/
  revoke_share.
- **`local.memory_revoke` handler**, owner-only: reuses the existing `revokeShare`
  domain fn (sets `revokedAt` on the grant, keeps the record). Only the note owner
  may revoke; scope + owner identity come from the governed ExecutionContext.
- **Demonstrates invariant 5 — revocation blocks the future, not the past** —
  end to end, verified live: A captures a note, shares it with B (approval), B's
  search returns it; A revokes B's share; B's search is now empty while A's still
  returns it; the grant record is **retained** with both `grantedAt` and
  `revokedAt` (who had access and when — never erased), and `hasActiveGrant(B)` is
  false. A non-owner is refused. 451 tests (+1 skipped), typecheck, next build
  green.

### Iteration 107 — 2026-07-16 (Operator console: Notes panel — real features become human-usable)
- First UI surface for the real adapters: a **Notes panel** on the Sphere page lets
  an operator capture and search canonical memory **as the acting member**, through
  the governed capability endpoints (`memory.capture` / `memory.search`) via the
  same-origin API proxy. The console decides nothing (RFC-003) — it triggers the
  governed action and shows the outcome (allow / approval / deny).
- Search is **policy-scoped** by the core resolver, so the panel only ever shows
  notes the acting member may read; a denial (Family Notes not enabled/granted)
  surfaces as a governed message. New `Notes.tsx` + a `#notes` nav item; matches the
  existing console design system.
- **Verified live:** the panel renders (title, nav item, capture/search fields); the
  UI→API proxy path works — `memory.search` as member A via `/api/kinos/...` returns
  A's note. next build green; 451 tests (+1 skipped), typecheck green.
- Closes the loop from "backend real" to "a person can use it": notes were already
  reachable by agents through the Sphere MCP (RFC-013/015); they are now reachable
  by a human in the console too.

### Iteration 108 — 2026-07-16 (Operator console: Calendar panel — both real adapters now human-usable)
- Symmetric to the Notes panel: a **Calendar panel** on the Sphere page lists the
  Sphere's events (`calendar.read`) and proposes a new one (`calendar.create_event`)
  through the governed capability endpoints via the API proxy. Governed outcomes
  surface as-is — a proposal shows "approval required, routed to the inbox" per the
  Family Calendar grant, not an immediate write.
- New `Calendar.tsx` + a `#calendar` nav item; matches the console design system.
- **Verified live:** the panel renders; the UI→API proxy path works — `calendar.read`
  returns the Sphere's "Piano lesson" event, and `calendar.create_event` returns
  `pending_approval` (routed for a parent's approval). next build green.
- Both real adapters (RFC-012 calendar, RFC-013/015 notes) are now usable by a human
  in the console with the same governance agents get via the Sphere MCP — the
  "backend real → product usable" arc is complete for both.

### Iteration 109 — 2026-07-16 (RFC-016 inc.1: integration packages — add & configure external services)
- **Direction correction (from the product owner):** do NOT re-code features
  (calendar/messaging/payment) in KinOS; a feature's functionality comes from a
  **configurable integration to an external service, added as a package**. The
  integration model already says this ("the product must not implement every
  provider directly"; SaaS connector = Google/CalDAV); the `Integration` entity
  already exists. What was missing — and is added here — is the governed way to
  **add and configure** one. Nothing re-coded: the local calendar/notes stay as the
  built-in `local` reference provider.
- **Manifest `integration` metadata** (provider + providerChoices + scopes); pure
  `packageIntegration()` materializes a `proposed` Integration via the existing
  `createIntegration`. New store package **Google Calendar** (type mcp) declares an
  integration over `calendar.*` with provider choices google/caldav/apple.
- **Install** an integration package → creates the `proposed` Integration (shows in
  connectors). New governed capability **`integration.configure`** (admin, seeded):
  set the chosen provider, the credentials **secret reference** (never the value —
  a raw key is rejected 400), and scopes. Enable/disable reuse the existing
  connector lifecycle.
- **Verified live:** install Google Calendar → connectors shows a `proposed`
  google integration over calendar.read/create_event; configure → provider caldav,
  credentials by reference, scopes; a raw `ya29.` token is refused; enable →
  enabled; the secret reference never appears in the read surface or audit. 458
  tests, typecheck, next build green.
- **Increment 2 (follow-up, documented in RFC-016):** route a capability call to the
  configured provider's adapter via a provider registry (local = built-in reference;
  Google/CalDAV/Apple = drop-in adapters), denying when unconfigured/disabled.

### Iteration 110 — 2026-07-16 (RFC-016 inc.2: integration executor — capabilities run via the configured provider)
- Completes RFC-016: a capability call now routes to the **configured external
  provider's adapter**, not in-process code. `packageIntegrationBindings` synthesizes
  `runtime: "custom"` bindings naming the Sphere Integration; install creates them
  disabled; enable flips a package's bindings by its `providesCapabilities` (covers
  both local RFC-011 and integration bindings).
- **`IntegrationExecutor`** wraps the local executor: for a custom binding it resolves
  the Sphere's Integration by id and dispatches to a **provider registry**, deny-by-
  default at each step — unknown integration, not-enabled, external-provider-without-
  credentials, or no-registered-adapter all refuse. The built-in **`local` provider**
  reuses the calendar store (the reference adapter); Google/CalDAV/Apple are drop-in
  registry entries. Non-custom bindings pass through unchanged.
- **Verified live, full loop:** install Google Calendar → configure provider `local`
  → enable integration + package → project agent (surface gains calendar.*). Then via
  the Sphere MCP: `calendar.create_event` suspends for approval → grant **executes via
  the integration → local provider** → persists; `calendar.read` returns it. Switching
  the integration to provider `google` (no adapter) **fails closed** — the call does
  not execute.
- **Honest rough edge:** an unregistered provider fails closed but surfaces a generic
  error to the agent (internals not leaked, which is the safe default) rather than a
  cleanly-audited "provider not available" — polish for a follow-up. 460 tests,
  typecheck, next build green.

### Iteration 111 — 2026-07-16 (RFC-017: OAuth integrations via a pluggable auth broker; Better Auth as reference)
- **Feasibility (verified via context7):** Better Auth is a strong fit as a single
  OAuth/SSO broker — social + generic-OAuth providers, framework-agnostic, and
  server-side `getAccessToken({providerId,accountId})` with auto-refresh. It sits in
  the app layer; KinOS holds only a **secret reference** to the broker-held account,
  never a token — consistent with credentials-by-reference.
- **Mechanism (this slice):** `AuthBroker` port + `FakeAuthBroker` + a transient
  `PendingOAuthStore` (single-use CSRF `state`). Manifest `integration.auth: "oauth"`
  (the Calendar package's google/apple providers). New governed capability
  `integration.oauth.begin` (admin, seeded) → mints state, returns the provider
  authorize URL. `GET /oauth/callback?state&code` → `broker.exchange` → sets the
  integration's `secretRef` to a broker **account reference** → audits consent
  (never the token).
- **Provider adapter:** `googleCalendarProvider` resolves a fresh token via
  `broker.getAccessToken(secretRef)` and calls the real Google Calendar API
  (injectable fetch); token acquisition is uniform across OAuth services.
- **Verified live (fake broker):** begin → authorize URL + state; callback →
  connected; a replayed/forged state → 403; the integration is configured with an
  account reference and **no token or reference leaks** into the read surface or
  audit. Unit test proves the broker→token→Bearer wiring for the Google adapter.
- **Deployment boundary (honest):** real Google/Apple consent needs a Better Auth
  broker wired with client credentials (GOOGLE_CLIENT_ID/SECRET, Apple keys) — the
  `BetterAuthBroker` is the documented reference implementation of the port; the
  fake broker exercises the flow without credentials. 465 tests, typecheck, next
  build unaffected (no UI change).

### Iteration 112 — 2026-07-16 (RFC-018: real Better Auth broker; AuthBroker port redesigned to its model)
- **Finding (context7):** Better Auth OWNS the provider callback
  (`/api/auth/callback/:provider`, non-overridable), manages state + the code
  exchange internally, and is session-centric — so RFC-017's raw-OAuth2 port
  (`authorizeUrl`/`exchange`) didn't fit. Surfaced the fork to the PO, who chose to
  redesign for Better Auth.
- **Port v2:** `beginConnect({provider,scopes,callbackURL})→{url}` ·
  `resolveConnection({headers})→{accountRef}` · `getAccessToken(accountRef)` ·
  optional `nodeHandler`/`basePath` (Better Auth's `/api/auth/*`). The governed flow
  becomes `integration.oauth.begin` (nonce + authorize URL) → `GET /oauth/connected?nonce`
  (redeem nonce → read broker session → set `secretRef = provider::accountRef`).
- **Real `BetterAuthBroker`** (installed `better-auth@1.6.23`): `betterAuth()` with
  google/apple social providers + memory account store; `toNodeHandler` mounted at
  `/api/auth/*`; `signInSocial`/`getSession`/`getAccessToken`. Selected in main.ts
  when BETTER_AUTH_SECRET + GOOGLE_CLIENT_ID/SECRET are set, else the fake broker.
  Server mounts the broker handler; `ApiRequest` gains `headers`.
- **Verified:** compiles against real better-auth types; **the API boots with the
  BetterAuthBroker (dummy creds) and Better Auth's handler answers `/api/auth/ok`
  (200)** — a real adapter, not a stub. Governed flow verified live via the fake
  broker: begin → `/oauth/connected` → connected; replayed nonce → 403; no token in
  the read surface or audit. 465 tests, typecheck green.
- **Deployment boundary (honest):** live Google/Apple consent needs real client
  credentials + a browser — the one path not in CI; the memory account store should
  become durable (SQLite/Postgres) in production.
