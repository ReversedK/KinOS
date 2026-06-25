# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

KinOS is a local-first trust infrastructure for personal and collective AI agents operating inside human **Spheres** (a person, family, team, organization, school, association or institution). The family is the first use case, not the boundary of the design.

**This repository currently contains only documentation — no implementation, build system, or tests exist yet.** It is a spec-first project: the accepted domain, architecture, and security documents in `docs/` are the source of truth that any future code must conform to.

## The governing development rule

From `README.md`, and it is binding:

> No substantial implementation should be added before the corresponding domain or architecture document exists and has been accepted.

Before writing implementation code for a behavior, confirm an accepted document in `docs/` defines it. If it does not, the document (ADR/RFC/architecture/domain) comes first. Use `docs/rfcs/000-template.md` for proposals.

## Documentation layout

- `docs/manifesto.md` — project intent and philosophy.
- `docs/contracts/` — **the hard constraints.** `invariants-contract.md` (30 things KinOS must never violate) and `results-contract.md` (observable product results + MVP validation criteria in §19). Read these before proposing anything.
- `docs/adr/` — accepted architecture decisions (sphere model, runtime/integration, memory, policy engine).
- `docs/domain/` — domain vocabulary (`domain-model.md`), capability catalog, entity lifecycle. This is business vocabulary, not a DB schema.
- `docs/architecture/` — `coding-principles.md` (the review checklist for implementation), event model, API contract, integration model, plugin SDK.
- `docs/security/` — trust, privacy, and threat models.
- `docs/rfcs/` — proposals; `000-template.md` is the template.

When asked about "how X should work," locate and quote the relevant doc rather than inventing semantics. If docs conflict, surface the conflict instead of silently picking one.

## Core architecture (read multiple docs to grasp this)

The central pattern is a **governance pipeline that runs before any model or runtime** (`docs/adr/001`, `docs/architecture/integration-model.md`):

```
User -> Identity Resolver -> Policy Engine -> Memory Resolver
     -> Capability Resolver -> Agent Runtime -> Tool / MCP / Integration
```

Key separations that every change must preserve:

- **Domain vs. runtime.** The domain core must not depend on Next.js, Hermes, n8n, MCP, OpenAI, Google, or any provider API. Hermes is the reference MVP runtime but is *not* a domain dependency — it executes; it never decides permissions, memory visibility, or policy.
- **Capabilities are the internal API.** Agents request abstract capabilities (e.g. `calendar.create_event`, `memory.search`), never raw tool/API names. A **Capability Binding** maps a capability to a concrete runtime tool/workflow/integration. Integrations are replaceable adapters that *implement* capabilities and never define permissions.
- **Security is applied before the runtime.** Only authorized memory and authorized capabilities are sent to the runtime; the runtime is a second line of defense, not the first. A prompt must never be the privacy boundary, and prompts never grant authorization — that belongs to the Policy Engine.
- **Memory is canonical; embeddings are derived** and regenerable. Memory survives model/provider/runtime changes; the model never owns memory.

## Non-negotiable principles for any implementation

From `docs/architecture/coding-principles.md` and `docs/contracts/invariants-contract.md`. Verify these before merging implementation code:

- No provider-specific dependency leaks into the domain core (adapters stay outside).
- No authorization is performed by a prompt; memory retrieval is policy-scoped; capability execution is policy-checked.
- **Deny by default** — missing config, missing permission, or uncertain risk means denial or an approval request.
- **Private by default; revocable by default** — silence/ambiguity is never consent; revocation blocks future access while past access stays as audit facts.
- Minors are restricted by default; supervision is not total surveillance.
- **Audit minimally** — record security facts, not private conversation content. Logs must not become data leaks.
- Every sensitive action carries a **correlation id** that chains policy check → approval → runtime call → integration call.
- Changing models must be "boring": no memory migration, no policy change.

## Working in this repo

- Documentation is Markdown; there is no build, lint, or test tooling. Edits are reviewed by reading.
- Commits in history are small and doc-scoped (e.g. "Add RFC 001 sphere-first architecture", "Add coding principles"). Match that granularity.
- The default branch is `main`.
