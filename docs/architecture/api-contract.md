# KinOS — API Contract

## Purpose

This document defines the minimum API surface required for MVP development. Endpoint shapes may evolve, but domain semantics must remain stable.

## Style

The MVP may use REST, RPC or server actions. Regardless of transport, APIs must preserve identity resolution, Sphere context, policy evaluation, audit correlation and explicit errors.

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

- list available capabilities;
- request capability execution;
- get capability execution status;
- bind capability to runtime tool;
- disable capability binding.

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

## Error model

Every denied request should return an error code, a user-safe message, a policy reason when safe and a correlation id.

## Non-goal

This file is not yet an OpenAPI specification. It is the semantic API contract for MVP development.
