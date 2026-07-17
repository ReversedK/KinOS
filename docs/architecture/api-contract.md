# KinOS — API Contract

## Purpose

This document defines the minimum API surface required for MVP development. Endpoint shapes may evolve, but domain semantics must remain stable.

## Style

The MVP may use REST, RPC or server actions. Regardless of transport, APIs must preserve identity resolution, Sphere context, policy evaluation, audit correlation and explicit errors.

## Cross-cutting request semantics

Every governed request, regardless of group, follows the same contract:

1. **Identity and Sphere context** are resolved first; an unresolved subject or Sphere is denied.
2. **Policy evaluation** runs before any memory retrieval, capability execution or external transfer. The API never performs authorization in handler logic that the Policy Engine could not reproduce.
3. **Deny by default**: a request with no explicit allow is refused.
4. **Three outcomes** map to responses: `allow` proceeds, `deny` returns an authorization error, `require_approval` returns a pending-approval result referencing an Approval Request.
5. **Correlation id**: a correlation id is generated at entry and returned on every response, success or failure, threading the audit chain.
6. **No raw tools**: capability APIs accept capability names, never runtime tool, MCP or workflow identifiers.

A `require_approval` outcome is not an error and not a success — it is a distinct pending state. Clients poll or subscribe for the approval decision; an expired approval resolves to denial.

## Core API groups

### Sphere APIs

- create Sphere;
- get Sphere;
- update Sphere settings;
- archive Sphere;
- export Sphere.

### Member APIs

- invite member;
- list members;
- update role;
- suspend member;
- remove member.

### Agent APIs

- create agent;
- list agents;
- update agent configuration;
- pause agent;
- disable agent;
- send message to agent.

### Memory APIs

- create memory;
- search memory;
- update memory;
- share memory;
- revoke memory access;
- delete memory;
- export memory.

### Policy APIs

- create draft policy;
- test policy;
- activate policy;
- disable policy;
- list policy versions.

### Capability APIs

- list available capabilities (returns only capabilities authorized for the subject);
- request capability execution (by capability name; returns allow/deny/require_approval with correlation id);
- get capability execution status;
- bind capability to runtime tool (governed; binding is an admin action, not an agent action);
- disable capability binding.

`request capability execution` is re-evaluated by the Policy Engine at call time even if the capability appeared in the subject's available list. `list available capabilities` never reveals a capability the subject is not authorized to see.

### Approval APIs

- create approval request;
- list pending approvals;
- grant approval;
- deny approval;
- expire approval.

### Integration APIs

- list integrations;
- enable integration;
- disable integration;
- update scopes;
- disconnect integration credentials.

### Audit APIs

Read-only inspection of the governance chain (RFC-020). Reads return events exactly
as recorded; audit minimality is guaranteed at record time by `event-model.md`, not
by these projections. Events must be safe to inspect by authorized administrators.

- list recent Sphere activity (newest first; bounded — the caller may request a
  `limit`, which the server caps; an audit read must never drain the log);
- get the event chain for a correlation id (reconstructs one sensitive action: who
  asked, which policy version decided, whether approval was required and by whom it
  was answered, what executed and through which integration).

## Error model

Every denied request should return an error code, a user-safe message, a policy reason when safe and a correlation id.

Minimum error/decision codes:

- `unauthenticated` — identity could not be resolved;
- `forbidden` — Policy Engine returned deny (with safe reason and deciding policy reference where safe);
- `approval_required` — Policy Engine returned require_approval; response references the Approval Request;
- `approval_expired` — a required approval lapsed and resolved to denial;
- `not_found` — resource absent or not visible to the subject (absence and forbidden may be merged to avoid leaking existence of private resources);
- `invalid_request` — malformed input; treated as denial for governed actions;
- `unknown_capability` — capability name not in the catalog; always denied.

Error responses must not leak private content in the reason: name the policy and decision class, not the protected data.

## Non-goal

This file is not yet an OpenAPI specification. It is the semantic API contract for MVP development.
