# KinOS — Threat Model

## Purpose

This document identifies the minimum threats KinOS must design against before development.

## Actors considered

- external attacker (no account, reaches the system via content, documents, tool outputs or a compromised integration);
- malicious or curious member (has an account and a role in the Sphere);
- over-reaching supervisor (a legitimate governance role attempting total surveillance);
- compromised integration or runtime (trusted component that misbehaves or leaks);
- the model itself (untrusted for security; may hallucinate facts, permissions or actions).

## Cross-cutting mitigations

Several threats share the same structural defenses, applied before the runtime:

- deny by default and fail closed on error;
- authorization decided only by the Policy Engine, never by a prompt or model;
- memory filtered before prompt construction; capabilities filtered before planning;
- external content treated as untrusted data, never as instructions or authorization;
- every sensitive action carries a correlation id and emits a minimal audit fact.

## Threats

### Prompt injection

External content or tool output attempts to override instructions, leak memory or trigger unauthorized tools.

Mitigation: treat external content as untrusted, isolate it, validate tool calls through Policy Engine.

### Unauthorized memory access

An agent or member asks for memory they do not own or that was not shared with them.

Mitigation: filter before retrieval and before prompt construction.

### Runtime overreach

The agent runtime receives too much context or too many tools and acts beyond intended scope.

Mitigation: capability allowlists and pre-runtime filtering.

### Integration compromise

A third-party integration leaks data, changes behavior or is compromised.

Mitigation: scoped credentials, capability bindings, revocation, audit and adapter isolation.

### Malicious or curious member

A member attempts to bypass policies by asking another agent, abusing shared memory or manipulating approvals.

Mitigation: subject-aware policy checks, owner-preserving shared memory, audit and denial by default.

### Parent or supervisor overreach

A governance role becomes total surveillance.

Mitigation: distinguish audit from private content, make escalation explicit, minimize logs.

### Minor unsafe interaction

A child receives unsafe advice, uses dangerous tools or contacts strangers.

Mitigation: restricted default profiles, blocked capabilities, approvals and output validation.

### Cloud leakage

Data is sent to a remote model or service without clear consent.

Mitigation: external transfer policy, visible model use, local-first defaults.

### Audit data leak

Logs become a parallel copy of private conversations.

Mitigation: minimal audit schema, content redaction, retention controls.

### Model hallucination

A model invents facts, permissions, memories or actions.

Mitigation: structured context, source references, policy-controlled execution, validation. A hallucinated capability call still passes through the Policy Engine and is denied if unauthorized; a hallucinated permission has no effect because permissions are not read from model output.

### Confused-deputy via agent chaining

A member or agent asks another agent (e.g. the Sphere agent) to perform an action the requester could not perform directly, hoping the second agent's broader access leaks through.

Mitigation: policy checks are subject-aware and evaluated for the acting subject and the member represented (`onBehalfOf`); an agent never inherits a requester's denied rights, and shared memory keeps its original owner and revocation rules.

### Privilege escalation through self-granting

An agent attempts to enable an integration, bind a capability or widen its own memory access.

Mitigation: agents never grant their own rights; `integration.enable`, capability binding and scope widening are governed actions requiring policy authorization and, where risky, human approval.

### Approval manipulation

A subject tries to auto-approve its own restricted action, replay an expired approval, or route approval to a non-authorized role.

Mitigation: `require_approval` names authorized approver roles; approvals expire and resolve to denial; an expired or denied approval is terminal; approval, runtime and integration calls share one correlation id for traceability.

## MVP security requirement

The MVP must demonstrate denial of unauthorized memory access, denial of unauthorized tool use by a child profile, approval before a high-risk action and audit without full conversation leakage.
