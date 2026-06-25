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

## What reaches the runtime

The pipeline upstream of the runtime is authoritative. By the time a session reaches the runtime, two things have already been filtered:

- **Context** — only memory items the Policy Engine authorized for the subject (see `docs/adr/002`).
- **Capabilities** — only the capabilities the Policy Engine authorized for the subject, presented to the runtime as a concrete, scoped tool list via bindings.

The runtime never sees forbidden memory and never sees a tool for a capability it was not granted. A capability the subject lacks is simply absent from the runtime's tool list; the runtime cannot request what it was never given.

```text
Identity Resolver -> Policy Engine -> Memory Resolver -> Capability Resolver
  -> (authorized context + authorized capability/tool list)
  -> Agent Runtime
```

## Capability resolution and double-check

Even though the offered tool list is pre-filtered, capability execution is re-checked at call time. When an agent invokes a capability:

1. The Capability Resolver maps the capability to its active Capability Binding.
2. The Policy Engine is consulted again for that specific execution (resource id, risk, cost, local/cloud, time).
3. On `allow`, the binding executes through the runtime/adapter.
4. On `require_approval`, execution suspends until a human with an authorized role responds.
5. On `deny`, execution is refused with an explainable reason.

This makes the runtime a second line of defense: the offered list is the first filter, the per-call policy check is the enforced one.

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

A Capability Binding maps one abstract capability to one concrete runtime/adapter operation. A capability may have several bindings (e.g. a local and a cloud implementation); the active binding is selected by Sphere configuration and policy (local-first by default).

Example binding:

```ts
type RuntimeToolBinding = {
  capability: string;          // e.g. 'calendar.create_event'
  runtime: 'hermes' | 'local' | 'n8n' | 'custom';
  runtimeToolName: string;     // provider-specific name, never leaks into the domain
  execution: 'local' | 'cloud';
  risk: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;   // a binding-level floor; policy may still require more
  status: 'proposed' | 'enabled' | 'disabled' | 'deprecated' | 'removed';
};
```

Binding rules:

- The domain references `capability` only. `runtimeToolName` is an adapter detail and must never appear in domain code, prompts or audit reasons.
- Bindings declare risk and `requiresApproval` as a floor; the Policy Engine may raise the requirement (e.g. require approval for a binding marked low-risk because of context) but the runtime can never lower it.
- A binding is replaceable. Swapping the binding for `calendar.create_event` from one provider to another must not change identities, memories or policies.
- Disabling a binding blocks future execution immediately; historical audit remains readable.

## Provider independence

The domain core must not import or depend on Next.js, Hermes, n8n, MCP, OpenAI, Google or any provider SDK. Provider-specific logic lives only in adapters behind bindings. This keeps integrations replaceable adapters that implement capabilities and never define permissions.

## Failure containment

A failure in a model, runtime, workflow or integration must not compromise a Sphere:

- A binding failure resolves as a failed capability execution with an audit event, not as a silent success or an escalation of rights.
- A compromised or misbehaving adapter cannot read memory it was not handed or call capabilities it was not bound to.
- Runtime or integration errors fail closed: no fallback that bypasses the Policy Engine.

## Security rule

KinOS filters context and capabilities before sending anything to the runtime.

The runtime is a second line of defense, not the first.

## Consequences

- No domain code may depend directly on Hermes tool names.
- No prompt is used as the source of authorization.
- n8n can execute workflows, but cannot become the policy engine.
- Runtime replacement must not require data migration.
