# KinOS — Integration Model

## Purpose

KinOS will need many integrations. The product must not implement every provider directly in the domain core.

An integration is a replaceable adapter that *implements* capabilities. It never defines permissions, never owns memory, and never decides consent. Removing an integration must change *how* a capability runs, never *whether* it is allowed.

## The chain

Every external action follows the same path:

```text
Agent request
  -> Capability                 (abstract action, e.g. calendar.create_event)
  -> Policy Engine              (allow / deny / require approval)
  -> Capability Binding         (selects a concrete implementation for this Sphere)
  -> Runtime / Adapter          (executes the binding)
  -> Integration                (Google, CalDAV, n8n, MCP server, local provider)
```

The Policy Engine sits *before* the Capability Binding. A denied capability is never bound, never executed, and never reaches an integration. The binding answers "how", never "if".

## Definitions

### Capability

A governed abstract action (see `capability-catalog.md`). The domain only ever names capabilities. It never names `googleCalendar.events.insert`, an MCP tool id, or an n8n workflow id.

### Capability Binding

A per-Sphere mapping from one capability to one concrete integration operation. A binding declares:

- the capability it implements;
- the integration and operation it targets;
- required scopes;
- the secret reference (never the secret itself);
- whether the operation performs an external transfer;
- lifecycle state (see `entity-lifecycle.md`: proposed, enabled, disabled, deprecated, removed).

A capability may have several bindings across Spheres. Sphere A can bind `calendar.create_event` to Google; Sphere B can bind the same capability to CalDAV. Agents in both Spheres call the identical capability and are unaware of the difference.

### Integration

The adapter itself: a provider plus its credentials reference, scopes, status, capability bindings and audit settings (see `domain-model.md`). One integration may back many bindings.

## Integration types

| Type | Executes via | Example |
|------|--------------|---------|
| local adapter | in-process domain code | local note store, local search |
| Hermes tool | reference MVP runtime | a tool Hermes exposes |
| MCP server | Model Context Protocol adapter | external MCP tool server |
| n8n workflow | n8n execution engine | multi-step automation |
| SaaS connector | provider HTTP API | Google Calendar, Gmail |
| custom provider adapter | bespoke adapter | proprietary internal system |

The type is an implementation detail. The capability surface is identical regardless of type; the same `calendar.create_event` may be backed by any of them.

## Rules

- Integrations implement capabilities; they never define domain permissions.
- An integration is selected only after the Policy Engine has allowed the capability.
- Integrations can be enabled and disabled per Sphere. Enabling in one Sphere does not enable it in another.
- Credentials and secrets are stored outside domain entities. Bindings hold a secret *reference*, never the secret value.
- Required scopes must be declared by the binding and visible to administrators.
- Every external transfer must be auditable: what data, to which service, under which capability, under which consent, with a correlation id.
- An integration must be replaceable without changing any policy, memory item, or capability name.
- A failure in an integration must be contained to that capability call and must not compromise the Sphere (see invariant 24).

## Secret and scope handling

- Secrets live in a secret store keyed by reference. Domain entities, audit events and exports store the reference, never the value.
- A binding requests the *minimum* scopes its operations need. Broad scopes are denied by default and require explicit administrator approval.
- Revoking an integration's credentials disables its bindings for future calls. Past audit facts remain.
- Scope changes are a binding change and must be auditable.

## Per-Sphere enable / disable

- Integrations are activated per Sphere, never globally by default.
- `integration.enable` and `integration.disable` are themselves high-risk capabilities (see `capability-catalog.md`) and are policy-checked.
- Disabling an integration moves its bindings to `disabled`; future capability calls that resolve to those bindings are denied. Historical audit remains readable.
- A capability with no enabled binding in a Sphere is *unavailable* in that Sphere — deny by default, not error-and-guess.

## Audit of external transfers

Before data leaves the local environment, KinOS must record (invariant 14):

- the capability and binding used;
- the destination integration and operation;
- the data class transferred (not the raw private content);
- the consent or policy decision that authorized it;
- the correlation id linking policy check -> approval (if any) -> runtime call -> integration call.

Audit records security facts, not conversation content (invariant 16).

## n8n

n8n may be used as an execution engine for workflows. It must never be the source of truth for identity, memory, policy or consent.

- An n8n workflow is reachable only through `n8n.workflow.run` bound to an approved, controlled binding.
- The Policy Engine decides whether the workflow may run; n8n only executes it.
- A workflow must not re-enter KinOS to grant itself rights, read unauthorized memory, or call capabilities the requesting agent lacks.
- n8n credentials are KinOS secret references, scoped to the binding.

## Hermes

Hermes may expose integration tools. KinOS must still map them through capability bindings and evaluate policies before exposing them to agents.

- Hermes executes; it never decides permissions, memory sharing, approvals or confidentiality (invariant 28).
- A Hermes tool is never offered to an agent directly. It is wrapped by a capability and a binding, and only surfaced after a policy check.
- Replacing Hermes with another runtime must not change capabilities, bindings semantics, policies or memory.

## Acceptance criteria

A new integration is acceptable only if:

- it maps to one or more declared capabilities (no new raw-tool surface for agents);
- each binding declares its required scopes, and they are minimal;
- it has a declared risk level consistent with the capability it implements;
- it can be enabled and disabled per Sphere;
- it stores secrets by reference, outside domain entities;
- it can emit audit events, including external-transfer facts with a correlation id;
- it does not bypass the Policy Engine;
- it can be replaced by another implementation of the same capability without any policy or memory change.

If any criterion fails, the integration is rejected (deny by default).

## Worked example — `calendar.create_event`

1. A personal agent requests the capability `calendar.create_event` with a candidate payload.
2. The Policy Engine evaluates the request in the Sphere context: subject role, sensitivity, minor restrictions, risk level (medium). It returns allow, deny, or require-approval. A correlation id is created here.
3. If approval is required, an `ApprovalRequest` is raised; execution is blocked until a human approver decides.
4. On allow, the Capability Binding for this Sphere is resolved — say, the Google SaaS connector — using its secret reference and declared scopes.
5. The runtime/adapter executes the bound operation. Because this is an external transfer, an audit event records the data class, destination, consent decision and correlation id.
6. The result is returned to the agent as the capability's output schema. The agent never saw the provider API.

Counter-example (rejected): an agent asks Hermes to call a Google tool directly, or an n8n workflow reads a member's private memory and "decides" it may be shared. Both bypass the capability + policy boundary and are denied. The integration must not be the privacy boundary; the prompt must not be the privacy boundary; the Policy Engine is.

## Counter-examples (what an integration must never do)

- Define who may use it (that is policy).
- Decide that a memory item may be shared (that is consent + policy).
- Hold the only copy of canonical memory (memory is canonical in the domain; integrations are adapters).
- Carry a permission inside a prompt or workflow parameter.
- Grant an agent a capability the agent was not authorized for.
