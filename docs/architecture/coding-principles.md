# KinOS — Coding Principles

## Purpose

This document defines rules developers must follow when implementing KinOS. These are architectural rules, not formatting preferences.

## Principles

### 1. Domain first

The domain core must not depend on Next.js, Hermes, n8n, MCP, OpenAI, Google or any provider-specific API.

### 2. No permissions in prompts

Prompts can describe behavior but never grant access. Authorization belongs to the Policy Engine.

### 3. No direct tool calls from agents

Agents request capabilities. Capabilities are resolved and checked before runtime tool execution.

### 4. Filter before runtime

Only authorized memory and authorized capabilities may be sent to the runtime.

### 5. Memory is canonical; embeddings are derived

Embeddings can be regenerated. They are not source of truth.

### 6. Deny by default

Missing configuration, missing permission or uncertain risk means denial or approval request.

### 7. Audit minimally

Record security facts. Do not copy full private conversations into logs.

### 8. Keep adapters outside the core

Integrations are adapters. Provider-specific logic belongs outside the domain.

### 9. Model replacement must be boring

Changing models must not require memory migration or policy changes.

### 10. Every sensitive action has a correlation id

Policy checks, approvals, runtime calls and integration calls must be traceable as one chain.

## Review checklist

Before merging implementation code, verify:

- no provider-specific dependency leaked into domain core;
- no authorization is performed by a prompt;
- memory retrieval is policy-scoped;
- capability execution is policy-checked;
- audit events are minimal;
- external transfers are explicit.
