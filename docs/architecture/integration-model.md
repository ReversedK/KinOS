# KinOS — Integration Model

## Purpose

KinOS will need many integrations. The product must not implement every provider directly in the domain core.

## Model

KinOS uses this chain:

```text
Agent request
  -> Capability
  -> Policy Engine
  -> Capability Binding
  -> Runtime / Adapter
  -> Integration
```

## Integration types

- local adapter;
- Hermes tool;
- MCP server;
- n8n workflow;
- SaaS connector;
- custom provider adapter.

## Rules

- Integrations implement capabilities.
- Integrations do not define domain permissions.
- Integrations can be disabled per Sphere.
- Credentials and secrets are stored outside domain entities.
- Scopes must be visible to administrators.
- External transfers must be auditable.

## n8n

n8n may be used as an execution engine for workflows. It must not be the source of truth for identity, memory, policy or consent.

## Hermes

Hermes may expose integration tools. KinOS must still map them through capability bindings and evaluate policies before exposing them to agents.

## Acceptance criteria

A new integration is acceptable only if:

- it maps to declared capabilities;
- it declares required scopes;
- it has a risk level;
- it can be disabled;
- it can emit audit events;
- it does not bypass Policy Engine.
