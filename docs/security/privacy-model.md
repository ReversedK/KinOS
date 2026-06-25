# KinOS — Privacy Model

## Purpose

This document defines how KinOS protects privacy across persons, Spheres, agents, memory, audit and integrations.

## Privacy principles

- Private by default.
- Explicit sharing.
- Revocable access.
- Minimal disclosure.
- Local-first operation.
- Model-independent memory.
- Audit without surveillance.

## Privacy scopes

### Private

Visible only to the owner and authorized processes acting for the owner.

### Shared with selected members

Visible only to explicitly selected members or agents representing them.

### Shared with supervisors

Used for family or organizational governance. Must not imply total surveillance.

### Shared with Sphere

Visible to the Sphere agent and authorized Sphere members.

### Public/exportable

Marked as suitable for export or publication, subject to final policy evaluation.

## Minor privacy

Minors need protection and personal space. KinOS distinguishes:

- safety alerts;
- audit events;
- private conversations;
- private memories;
- parental approvals.

Parents or supervisors can govern the environment without automatically reading all private conversations.

## External transfers

Before external transfer, KinOS must know:

- data class;
- destination service;
- purpose;
- capability;
- consent source;
- retention expectation if known.

## Audit privacy

Audit events should record decisions and metadata, not unnecessary content.

Example good audit: `child_agent denied message.send because policy minors_external_messages denied`.

Example bad audit: full private conversation copied into logs.
