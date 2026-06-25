# ADR-006 — Implementation Stack and Project Layout

## Status

Accepted for MVP.

## Context

KinOS is, until now, a spec-only corpus. No implementation, build, or test
tooling exists. The governing rule (`README.md`, `CLAUDE.md`) forbids
substantial implementation before an accepted document defines it. Choosing a
concrete stack is itself such a decision: it determines how every later
increment is built, and it must not contradict the invariants
(`docs/contracts/invariants-contract.md`), the coding principles
(`docs/architecture/coding-principles.md`), or ADR-001's separation of domain
from runtime.

The existing corpus already constrains the choice heavily:

- Every code sample in the docs is TypeScript (e.g. the `RuntimeToolBinding`
  type in ADR-001 is `ts`).
- ADR-001 and coding principle 1 forbid the domain core from importing Next.js,
  Hermes, n8n, MCP, OpenAI, Google or any provider SDK.
- Results-contract §15/§16 require local-first operation and a local model
  runtime, with cloud as an optional extension.
- Results-contract §11 names Hermes as the *reference* runtime but requires
  KinOS to stay conceptually independent of it.
- Results-contract §17 requires documented, restorable export.

What was genuinely open — and is settled here — is the language runtime, the
local model runtime for the MVP, the local persistence engine, and the first
external surface.

## Decision

### Language and runtime

KinOS is implemented in **TypeScript on Node.js**. The domain core is plain
TypeScript with **no provider, runtime, framework or I/O dependency** — it
imports neither Node built-ins for I/O, nor any SDK. All I/O (persistence,
model calls, integrations, HTTP) lives in adapters outside the core.

### Local model runtime (MVP)

The MVP satisfies "runs with a local model runtime" (§19) via **Ollama**,
reached over its local HTTP API behind a runtime adapter. Ollama is an adapter
detail: the domain references capabilities, never Ollama. The same adapter seam
admits Hermes or an OpenAI-compatible local server later without domain change
(ADR-001 binding replaceability).

### Persistence (MVP)

Canonical memory, identities, Spheres, members, policies, bindings and audit
events are stored in **SQLite** (single file, no external service — satisfies
local-first by default, §15). Persistence is reached through a repository port
defined by the domain; SQLite is the adapter behind it. **Embeddings are a
derived, regenerable index** (coding principle 5) and are never the record;
they may live in a separate store added in a later iteration.

### First surface (MVP)

The §19 validation behaviors are first exposed through a **domain API plus a
thin CLI**, so each criterion is demonstrable by tests and commands before any
UI exists. The **Next.js UI is deferred** to a later iteration (results-contract
§18 requires a UI that hides complexity, but §19 validation does not require it).
Per coding principle 1, the UI — when it lands — is a consumer of the API and
never a place where policy or memory visibility is decided.

### Project layout

A TypeScript monorepo with workspace packages, enforcing the dependency
direction by package boundaries (the core cannot import an adapter):

```text
packages/
  core/            # pure domain: identity, sphere, member, policy engine,
                   # memory model, capability + binding model, audit.
                   # No provider/runtime/framework/I/O imports. Ports only.
  adapters/
    persistence-sqlite/   # implements the core's repository ports
    runtime-ollama/       # implements the agent-runtime port
  app/
    cli/           # thin CLI over the core's application services
    api/           # local HTTP API (added when needed; CLI first)
  ui/              # Next.js (deferred; consumes the API)
```

Dependency rule (enforced by review, later by lint/boundaries tooling):
`core` depends on nothing in the repo; `adapters/*` and `app/*` depend on
`core`; nothing depends on `app/*` except `ui`. A provider SDK appearing in
`core` is a blocking review failure (coding principle checklist, line 1).

### Tooling

- **Package manager / workspaces:** npm workspaces (zero extra install;
  revisit pnpm only if workspace ergonomics demand it).
- **Test runner:** Vitest. TDD is mandatory (mvp-loop step 4): a failing test
  encoding the slice's acceptance criteria precedes implementation.
- **Type checking:** `tsc --strict` (strict mode on from the first commit).
- **No build step for the core** beyond `tsc`; adapters/app may add bundling
  only when a real consumer needs it.

## Consequences

- The domain core stays portable and provider-independent (invariants 12, 26,
  30; coding principle 1). Swapping Ollama→Hermes, SQLite→Postgres, or CLI→UI is
  an adapter change, not a domain migration (coding principle 9).
- Local-first and "no external service mandatory for the core" (§1, §15) hold:
  SQLite + Ollama both run on the local machine.
- TDD and the dependency direction are mechanically checkable, supporting the
  coding-principles review checklist.
- Deferring the UI front-loads the governance pipeline (the security-critical
  part) and proves §19 by tests before investing in presentation.
- Choosing npm workspaces and Vitest is reversible and local; neither leaks into
  the domain core.

## Non-goals

- This ADR does not choose embedding models, a vector store, an integration
  engine (n8n) wiring, or cloud-model providers. Those are later, separately
  accepted decisions behind bindings.
- This ADR does not define API or CLI command shapes; those follow
  `docs/architecture/api-contract.md` and per-slice acceptance criteria.
