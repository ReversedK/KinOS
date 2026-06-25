# KinOS — Domain Model

## Purpose

This document defines the minimum domain vocabulary required for development. It is not a database schema. It defines the business objects and their relationships.

## Core entities

### Sphere

A governed unit of human representation.

Fields/concepts:

- id;
- type;
- name;
- administrators;
- members;
- policies;
- capabilities;
- memory;
- integrations.

### Member

A human or Sphere participating in another Sphere.

Fields/concepts:

- id;
- identity;
- Sphere membership;
- role;
- profile;
- status.

### Agent

A digital representative of a person or Sphere.

Fields/concepts:

- id;
- owner;
- scope;
- runtime configuration;
- model preference;
- enabled capabilities;
- memory access profile.

### MemoryItem

A durable, governed unit of memory.

Fields/concepts:

- id;
- owner;
- Sphere;
- content;
- summary;
- visibility;
- sensitivity;
- lifecycle state;
- source;
- audit references.

### Policy

A rule evaluated by the Policy Engine.

Fields/concepts:

- id;
- Sphere;
- subject selector;
- action;
- resource selector;
- context conditions;
- effect;
- version;
- status.

### Capability

An abstract action agents can request.

Fields/concepts:

- name;
- description;
- risk level;
- input schema;
- output schema;
- policy requirements;
- implementation bindings.

### Integration

An external or local adapter implementing capabilities.

Fields/concepts:

- provider;
- credentials reference;
- scopes;
- status;
- capability bindings;
- audit settings.

### ApprovalRequest

A human validation request required before an action.

Fields/concepts:

- requester;
- agent;
- Sphere;
- capability;
- payload;
- risk;
- approvers;
- decision;
- expiry.

### AuditEvent

A minimal record of a security-relevant event.

Fields/concepts:

- actor;
- agent;
- Sphere;
- event type;
- resource class;
- decision;
- reason;
- timestamp;
- correlation id.

## Relationship summary

- A Sphere has many Members.
- A Sphere has many Agents.
- A Sphere has many Policies.
- A Sphere has many Capability bindings.
- A Member can own one or more Agents.
- A MemoryItem has one owner and may be shared with many subjects.
- An Integration implements one or more Capabilities.
- A Policy controls access to MemoryItems, Capabilities, Integrations and Sphere resources.
