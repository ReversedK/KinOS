# KinOS — Trust Model

## Purpose

This document defines trust boundaries. It answers: who trusts whom, for what, and under which limits.

## Trust hierarchy

KinOS must not treat all components as equally trusted.

From most trusted to least trusted:

1. User-owned canonical data.
2. KinOS domain core.
3. Policy Engine.
4. Memory Resolver.
5. Capability Resolver.
6. Agent runtime.
7. LLM models.
8. Integration adapters.
9. External services.
10. User-provided content and remote documents.

## Core trust assumptions

### KinOS domain core

Trusted to enforce domain rules, ownership, lifecycle and invariants.

### Policy Engine

Trusted to decide allow, deny or require approval. Must be deterministic where possible.

### Memory Resolver

Trusted to retrieve only authorized memory. Must run before prompt construction.

### Agent runtime

Partially trusted. It can execute conversations and tools but must not receive unauthorized data or capabilities.

### LLM

Untrusted for security. Useful for language understanding and generation. Not trusted for access control.

### Integrations

Partially trusted. They implement capabilities but can fail, leak, change API behavior or be compromised.

### External content

Untrusted. Documents, web pages, messages and tool outputs may contain prompt injections.

## Trust direction

Trust flows downward and is never returned upward. A less-trusted layer cannot grant itself the rights of a more-trusted one:

- the runtime cannot grant a capability it was not handed;
- the model cannot authorize access by asserting it in text;
- an integration cannot read memory it was not given;
- external content cannot promote itself by claiming authority in its body.

Authorization is decided only by the Policy Engine, above the runtime. Everything below it executes within already-decided bounds.

## Mandatory boundaries

- No forbidden memory crosses into prompts.
- No unapproved capability crosses into runtime tool lists.
- No external transfer happens without policy evaluation.
- No tool result is blindly trusted.
- No log may contain unnecessary private content.
- No prompt grants authorization; no model decides permissions, memory visibility or approvals.
- Agents never grant their own rights (capabilities, memory access, integrations).

## Trust-boundary checks

At each boundary crossing, a specific check applies:

- **Policy Engine → Memory Resolver**: only items authorized for `read` by the subject are retrieved.
- **Policy Engine → Capability Resolver**: only authorized capabilities become a runtime tool list; each execution is re-checked at call time.
- **Runtime → Integration**: calls flow only through Capability Bindings; raw provider APIs are never exposed to the domain.
- **External service → KinOS**: tool outputs and remote documents are untrusted input, treated as data, never as instructions or authorization (prompt-injection containment).

## Design consequence

Trust is layered. The failure of one layer must not compromise the entire Sphere. A compromised integration, a manipulated model output or a malicious external document is contained because the authorizing decision already happened above it and cannot be re-opened from below.
