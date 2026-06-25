# KinOS — Coding Principles

## Purpose

This document defines rules developers must follow when implementing KinOS. These are architectural rules, not formatting preferences. It is the review checklist a reviewer runs against a pull request.

Each principle states the rule, why it exists, and a concrete do / don't pair.

## Principles

### 1. Domain first

**Rule.** The domain core must not depend on Next.js, Hermes, n8n, MCP, OpenAI, Google or any provider-specific API.

**Why.** Providers, runtimes and interfaces are replaceable (invariants 12, 26, 30). If domain logic imports a provider, the provider becomes load-bearing and replacement breaks the system.

- Do: domain code references the capability `calendar.create_event`.
- Don't: domain code imports a Google Calendar SDK or constructs a Hermes tool call.

### 2. No permissions in prompts

**Rule.** Prompts can describe behavior but never grant access. Authorization belongs to the Policy Engine.

**Why.** A prompt is not a security boundary (invariants 3, 10). A model can be confused, jailbroken or replaced; policy cannot live there.

- Do: the Policy Engine decides, then only authorized data and capabilities reach the prompt.
- Don't: write "you are allowed to read the parents' private notes" in a system prompt.

### 3. No direct tool calls from agents

**Rule.** Agents request capabilities. Capabilities are resolved and policy-checked before any runtime tool executes.

**Why.** Capabilities are the internal API (invariants 11, 27). Raw tool access bypasses governance.

- Do: agent emits a `message.send` capability request.
- Don't: agent invokes an MCP tool id or an n8n workflow id directly.

### 4. Filter before runtime

**Rule.** Only authorized memory and authorized capabilities may be sent to the runtime.

**Why.** Security is applied before the runtime (invariants 3, 29). The runtime is a second line of defense, not the first.

- Do: resolve policy-scoped memory, then build the prompt from it.
- Don't: load all Sphere memory into context and rely on the model to ignore the forbidden parts.

### 5. Memory is canonical; embeddings are derived

**Rule.** Embeddings can be regenerated. They are not source of truth.

**Why.** Memory must survive model and provider changes (invariants 2, 23). Embeddings follow canonical memory lifecycle.

- Do: store canonical memory items; regenerate embeddings on demand.
- Don't: keep a fact only as a vector, or trust an embedding store as the record.

### 6. Deny by default

**Rule.** Missing configuration, missing permission or uncertain risk means denial or an approval request.

**Why.** Silence and ambiguity are never consent (invariants 4, 7, 21). The system refuses rather than guesses.

- Do: no enabled binding for a capability -> capability unavailable.
- Don't: fall back to a default integration or "allow because nothing said no".

### 7. Audit minimally

**Rule.** Record security facts. Do not copy full private conversations into logs.

**Why.** Audit is required, but logs must not become a data leak (invariants 9, 16).

- Do: record actor, capability, data class, decision, reason, correlation id.
- Don't: log the full message body or private memory content.

### 8. Keep adapters outside the core

**Rule.** Integrations are adapters. Provider-specific logic belongs outside the domain.

**Why.** Adapters are replaceable; the domain must not (invariants 12, 30). See `integration-model.md`.

- Do: a Google adapter implements `calendar.create_event` behind a binding.
- Don't: scatter Google-specific branching through domain services.

### 9. Model replacement must be boring

**Rule.** Changing models must not require memory migration or policy changes.

**Why.** The model is replaceable and owns nothing (invariants 2, 26). Identity, memory and policy are model-independent.

- Do: swap the model behind the runtime; memory and policies untouched.
- Don't: store policy state or memory ownership inside model-specific structures.

### 10. Every sensitive action has a correlation id

**Rule.** Policy checks, approvals, runtime calls and integration calls must be traceable as one chain.

**Why.** Sensitive decisions must be explainable (invariants 15, 18). One id chains the whole path.

- Do: create the correlation id at the policy check and carry it to the integration call and audit event.
- Don't: emit disconnected log lines that cannot be reconstructed into one action.

## Review checklist

A reviewer should be able to answer yes to each before merge. Any "no" or "unclear" blocks the merge (deny by default).

- [ ] No provider-specific or runtime-specific import in the domain core.
- [ ] No authorization is expressed, implied or relied upon in any prompt.
- [ ] Agents request capabilities only; no raw tool, MCP or workflow ids in agent-facing code.
- [ ] Memory retrieval is policy-scoped before prompt construction.
- [ ] Capability execution is policy-checked before the binding is resolved.
- [ ] Missing config / permission / risk results in denial or an approval request, never a silent allow or default.
- [ ] Embeddings (and any derived index) follow canonical memory lifecycle; canonical memory is the record.
- [ ] Audit events record security facts only — no full conversation or private content.
- [ ] Every sensitive action carries a correlation id chaining policy -> approval -> runtime -> integration.
- [ ] External transfers are explicit and audited (data class, destination, consent).
- [ ] Minor-restricted defaults are preserved; no path silently widens a minor's access.
- [ ] Swapping the model or runtime would require no memory migration and no policy change.
