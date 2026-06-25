# KinOS — Sphere Export Format

## Purpose

results-contract §17 requires that a Sphere can be exported and restored and
that the **format is documented**. ADR-002 ("Export and portability") requires
documented, open formats so memory remains readable over time, and that
embeddings are not exported as truth (they are derived and regenerable). This
document is that format reference for the MVP.

## Format

The export is a single UTF-8 JSON document. It is self-describing and versioned.

```jsonc
{
  "format": "kinos.sphere.export", // fixed discriminator
  "version": 1,                     // integer; importers reject unknown versions
  "exportedAt": "2026-06-25T10:00:00.000Z", // ISO 8601
  "sphere":     { /* Sphere, with members embedded */ },
  "identities": [ /* Identity[] */ ],
  "agents":     [ /* Agent[] */ ],
  "memory":     [ /* MemoryItem[] — canonical; no embeddings */ ],
  "policies":   [ /* Policy[] */ ]
}
```

Each section uses the canonical domain shapes defined in
`docs/domain/domain-model.md` and the `@kinos/core` types:

- **sphere** — id, type, name, status, administrators, and embedded members
  (id, identity, role, status). Membership and ownership are preserved.
- **identities** — id and display name; identity is distinct from member and
  agent identity.
- **agents** — id, owner, sphere, name, model preference, enabled capabilities,
  lifecycle state. The model preference is advisory; restoring on a different
  model must stay "boring".
- **memory** — canonical Memory Items with owner, owning Sphere, visibility,
  sensitivity, content/summary, source, lifecycle state, audit refs and share
  grants (including revoked grants, which are retained as audit facts).
- **policies** — structured policies (selectors, action, effect, conditions,
  priority, version, status). The executable rule, not prose, is exported.

## Rules

- **Embeddings and derived indexes are never exported as truth.** They are
  rebuilt from canonical memory after import.
- **Round-trip stable.** `import(JSON.parse(JSON.stringify(export(x)))) === x`
  for the included sections (optional fields that are absent stay absent).
- **Fail closed on import.** A non-object payload, an unknown `format`, an
  unsupported `version`, or missing required sections are refused, never
  guessed (deny by default).
- **Export is governed.** Producing or transferring an export — especially off
  the local machine — is itself a governed action and may require a policy check
  and an external-transfer evaluation (ADR-002, privacy model). The core
  `exportSphere` builds the snapshot; the caller performs the I/O and the
  governing check.

## Versioning

`version` is an integer. A reader that does not recognise the version must
refuse the import rather than partially apply it. Future format changes bump the
version and document the migration here.
