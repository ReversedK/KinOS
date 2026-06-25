# KinOS — Threat Model

## Purpose

This document identifies the minimum threats KinOS must design against before development.

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

Mitigation: structured context, source references, policy-controlled execution, validation.

## MVP security requirement

The MVP must demonstrate denial of unauthorized memory access, denial of unauthorized tool use by a child profile, approval before a high-risk action and audit without full conversation leakage.
