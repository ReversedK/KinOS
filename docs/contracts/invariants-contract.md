# KinOS — Invariants Contract v1.1

## Purpose

This document defines what KinOS must never violate. These invariants are stronger than features, implementation choices, integrations, runtimes and interface decisions.

## Invariants

### 1. Data belongs to users

KinOS never owns user data. Conversations, memories, documents, embeddings, profiles, rules, logs, configurations and exports belong to the users or Spheres that created them.

### 2. Memory never belongs to the model

The LLM is replaceable. Memory must survive model changes, provider changes, interface changes and runtime changes.

### 3. Permissions are applied before AI

The model only receives data it is allowed to see. A prompt must never contain forbidden data. A LLM must never be the only privacy boundary.

### 4. Private by default

New data is private by default unless explicitly shared. Silence and ambiguity never count as consent.

### 5. Revocable by default

Every authorization can be revoked. Revocation immediately blocks future access. Past access remains visible as audit facts.

### 6. Agents never grant their own rights

Agents cannot grant themselves tools, permissions, policies, memory access or integration access. Rights are governed by KinOS.

### 7. Missing permission means denial

No memory, capability, tool, integration or external action is implicitly available. The system refuses rather than guesses.

### 8. Minors are protected by default

Child and teen profiles must be restricted by default. They must not be assumed able to browse freely, contact strangers, publish, buy, delete, send external messages or access sensitive content.

### 9. Supervision is not total surveillance

Governance must not automatically expose all private conversations. KinOS distinguishes safety, audit, private conversation, private memory and risk escalation.

### 10. Policies do not live in prompts

Prompts may explain behavior, but governance rules are stored, versioned and executed by infrastructure.

### 11. Tools are controlled capabilities

Agents use declared capabilities, not raw APIs. Each capability has scope, permissions, risk level, implementation and execution policy.

### 12. Integrations are replaceable

No third-party integration is part of the domain core. Google, Apple, OpenAI, Hermes, n8n, Zapier, Pipedream, Composio and MCP servers are adapters.

### 13. Cloud is optional

Essential behavior must remain available locally. Remote models and cloud integrations require clear activation and consent.

### 14. External transfer is explicit

Before data leaves the local environment, KinOS must know what data is sent, to which service, why, under which consent and for which capability.

### 15. Sensitive actions are explainable

KinOS must explain important authorization, denial, approval, memory access, capability execution and external transfer decisions.

### 16. Logs must not become data leaks

Audit is necessary but must be minimized. Logs record security facts, not unnecessary private content.

### 17. Agents represent; they do not replace

An agent represents a person or Sphere. It must not claim to be the human or collective it assists.

### 18. Humans remain final authority

Agents can propose, organize, remind, automate and coordinate. They are never final authority for major decisions about health, money, education, relationships or physical safety.

### 19. Agent boundaries remain visible

Cooperation between agents must not merge identities. Each agent keeps owner, scope, memory, rights and responsibilities.

### 20. Shared memory keeps ownership

Sharing does not abandon ownership. A shared memory keeps its original owner and revocation rules.

### 21. The system must say no

User convenience never outranks safety, consent, privacy, minor protection or data integrity.

### 22. Simplicity beats magic

Predictable, explainable behavior is better than impressive but opaque automation.

### 23. Data must remain readable over time

Formats must be open or documented. A memory created today should remain understandable decades later.

### 24. Errors must be contained

A failure in an agent, model, runtime, workflow or integration must not compromise an entire Sphere.

### 25. The product protects against its own drift

Every new feature must be checked against this contract. A profitable feature that violates these invariants must be rejected.

### 26. The agent runtime is interchangeable

The runtime executing agents is a technical dependency, not domain truth. Replacing it must not change identities, memories, permissions, policies or Spheres.

### 27. Capabilities are the internal API

The domain manipulates capabilities, never Hermes tool names, MCP server names, n8n workflow IDs or third-party APIs directly.

### 28. Hermes is an executor, not a decision-maker

Hermes may plan, converse and call tools. It must not decide permissions, memory sharing, Sphere policies, approvals or confidentiality levels.

### 29. Security is applied before the runtime

The runtime receives only authorized memories, authorized context and authorized capabilities.

### 30. Integrations are adapters

All external providers are replaceable adapters. The domain behavior must not depend on a provider-specific API.

## Principle

KinOS is not a family chatbot. It is a trust infrastructure for personal and collective agents operating inside human Spheres.
