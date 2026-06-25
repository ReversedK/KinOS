# ADR-001 — Runtime and Integration Architecture

## Status

Accepted for MVP.

## Context

KinOS needs agent conversations, planning, tool calling and many integrations. Rebuilding every integration inside KinOS would be a mistake.

Hermes already provides an agent runtime, MCP support, tool discovery, tool execution, approvals and integration surfaces. n8n and other integration engines can also provide execution capabilities.

## Decision

KinOS separates domain governance from agent execution.

```text
User
  -> Identity Resolver
  -> Policy Engine
  -> Memory Resolver
  -> Capability Resolver
  -> Agent Runtime
  -> Tool / MCP / Integration
```

Hermes is the reference runtime for the MVP, but not a domain dependency.

KinOS talks in capabilities. Hermes talks in tools. Bindings map capabilities to runtime tools.

## Runtime responsibilities

The runtime may:

- run agent sessions;
- call models;
- plan tool use;
- execute MCP tools;
- expose tool events;
- request approvals;
- connect to integration engines.

The runtime must not:

- decide KinOS permissions;
- decide memory visibility;
- own user memory;
- define Sphere policies;
- bypass the Policy Engine.

## Capability binding

Example binding:

```ts
type RuntimeToolBinding = {
  capability: string;
  runtime: 'hermes' | 'local' | 'n8n' | 'custom';
  runtimeToolName: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
};
```

## Security rule

KinOS filters context and capabilities before sending anything to the runtime.

The runtime is a second line of defense, not the first.

## Consequences

- No domain code may depend directly on Hermes tool names.
- No prompt is used as the source of authorization.
- n8n can execute workflows, but cannot become the policy engine.
- Runtime replacement must not require data migration.
