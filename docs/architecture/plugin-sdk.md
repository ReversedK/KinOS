# KinOS — Plugin SDK

## Purpose

This document defines the direction for future extensibility. It is not an MVP requirement, but development must not block this path.

## Plugin types

KinOS may eventually support:

- capability plugins;
- integration adapters;
- memory providers;
- policy condition providers;
- UI extensions;
- agent profile templates.

## Required boundaries

Plugins must not bypass:

- identity resolution;
- Policy Engine;
- Memory Resolver;
- Capability Resolver;
- audit events;
- external transfer checks.

## Capability plugin contract

A capability plugin must declare:

- capability name;
- description;
- input schema;
- output schema;
- risk level;
- required scopes;
- implementation binding;
- audit metadata.

## Integration adapter contract

An integration adapter implements one or more capabilities. It must expose scopes, credential requirements, supported operations and risk classification.

## Non-goals for MVP

- public plugin marketplace;
- third-party untrusted code execution;
- dynamic remote plugin installation.

## Design rule

The core domain must remain stable even when plugins are added, removed or replaced.
