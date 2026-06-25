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

Plugins are adapters and extensions, not authorities. A plugin must not bypass:

- identity resolution;
- Policy Engine;
- Memory Resolver;
- Capability Resolver;
- audit events;
- external transfer checks.

In particular:

- a plugin never decides permissions, memory visibility or approvals;
- a plugin never grants itself or an agent new rights;
- a plugin receives only the context and capabilities already authorized for the request;
- a plugin's outputs are untrusted input, validated like any external content;
- a policy condition provider may supply a condition value (e.g. a risk or cost signal) but never the allow/deny decision itself.

## Registration and validation

A plugin is declared with a manifest and validated before it can be used:

- its declared capabilities must have valid names, schemas, risk levels and audit metadata;
- its bindings are governed entities and follow the Capability Binding lifecycle (proposed → enabled → disabled → deprecated → removed);
- enabling a plugin in a Sphere is a governed admin action, not an agent action;
- a plugin that fails validation is rejected; the system refuses rather than runs unknown code paths.

## Capability plugin contract

A capability plugin must declare:

- capability name (lowercase-dotted, stable);
- description;
- input schema;
- output schema;
- risk level;
- required scopes;
- implementation binding (provider details stay in the adapter, not in the domain);
- audit metadata (facts to record, never private content).

A capability added by a plugin is still subject to the Policy Engine and to subject-profile defaults; declaring a capability does not authorize it.

## Integration adapter contract

An integration adapter implements one or more capabilities. It must expose scopes, credential requirements, supported operations and risk classification.

It must also:

- keep credentials and secrets outside domain entities (referenced, not embedded);
- be disableable and revocable per Sphere without changing the domain model;
- emit audit events for its operations;
- never act as the permission engine.

## Packaging and distribution

Plugins and Skills are distributed and installed as **Packages** through the curated store (`docs/rfcs/002-package-store-and-skills.md`). A Package is the distribution and lifecycle wrapper around the plugin types above plus Skills. Curated, signed and sandboxed dynamic install is in scope for the MVP; install resolves dependencies, registers capabilities with bindings created disabled, and authorizes use only through policies confirmed at install. The Capability Resolver and Policy Engine still govern every call.

## Non-goals for MVP

- public/open plugin marketplace (curated store only; deferred to v2);
- third-party untrusted code execution (MVP packages are signed and sandboxed; unsigned third-party code deferred to v2);
- dynamic install of unverified packages (verified + signed + sandboxed install is in scope; unverified is v2).

## Design rule

The core domain must remain stable even when plugins are added, removed or replaced.
