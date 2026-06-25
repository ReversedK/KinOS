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

## Mandatory boundaries

- No forbidden memory crosses into prompts.
- No unapproved capability crosses into runtime tool lists.
- No external transfer happens without policy evaluation.
- No tool result is blindly trusted.
- No log may contain unnecessary private content.

## Design consequence

Trust is layered. The failure of one layer must not compromise the entire Sphere.
