# KinOS — Entity Lifecycle

## Purpose

This document defines the minimum lifecycle states for core KinOS entities. Lifecycles prevent deletion, revocation, disabling and archiving from being confused.

## Sphere lifecycle

States:

- draft;
- active;
- suspended;
- archived;
- deletion_requested;
- deleted.

Rules:

- archived Spheres are read-only by default;
- deletion must not silently delete member-owned private memory;
- export must be available before deletion when legally and technically possible.

## Member lifecycle

States:

- invited;
- active;
- suspended;
- left;
- removed;
- anonymized.

Rules:

- removing a member from a Sphere does not erase memory ownership;
- member private memory remains controlled by the member unless explicit legal/organizational rules apply.

## Agent lifecycle

States:

- configured;
- active;
- paused;
- disabled;
- exported;
- deleted.

Rules:

- disabling an agent does not delete memory;
- changing runtime or model does not create a new agent identity unless explicitly requested.

## Memory lifecycle

States:

- active;
- archived;
- revoked;
- deletion_requested;
- purged.

Rules:

- revocation blocks access but does not delete canonical memory;
- purge removes canonical memory and derived indexes where possible;
- embeddings are derived and must follow canonical memory lifecycle.

## Policy lifecycle

States:

- draft;
- test;
- active;
- disabled;
- superseded;
- archived.

Rules:

- active policies are versioned;
- policy changes must be auditable;
- a policy can be tested against simulated requests before activation.

## Capability binding lifecycle

States:

- proposed;
- enabled;
- disabled;
- deprecated;
- removed.

Rules:

- disabling a binding blocks future execution;
- historical audit remains readable after removal.
