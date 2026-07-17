# RFC-021 — Sphere export (full-fidelity, admin-gated)

## Status

Accepted

## Summary

Implement `sphere.export`: a governed capability returning the complete, documented
JSON snapshot of a Sphere (profiles, all memory, policies, bindings, integrations,
packages, settings) so it can be exported and restored. This closes the last unmet
MVP validation criterion — "data can be exported" (`results-contract` §19) — which
had no capability, no endpoint, and no UI; core's `exportSphere` existed only as an
internal persistence serializer.

The export is **full-fidelity**: it includes every member's memory, private items
included, because a snapshot that omits them cannot restore the Sphere. It is gated
behind an adult-only, approval-floored, audited capability. It is a **local backup**,
not an external transfer.

## Motivation

- `results-contract` §19 requires "data can be exported"; §17 requires a Sphere be
  "exported and restored", including memory. Nothing in the product did this.
- `export.ts` already produces the documented format and states that "the caller does
  the actual file/transfer I/O and the governing export policy check". This RFC is
  that caller.
- Portability is an anti-lock-in guarantee: a user who cannot take their data out is
  captive. That is precisely what KinOS exists to prevent.

## The conflict this resolves (and how)

The accepted docs define "export" two incompatible ways, and this was escalated to
the product owner rather than silently decided:

- **`results-contract` §17 (Portability)** — "Export includes profiles, **memory**,
  policies, knowledge, documents, settings and capability bindings where possible."
  Full fidelity, or a restore is lossy.
- **`ADR-002` / `privacy-model`** — `private` is "owner only"; only
  `public_exportable` is "marked suitable for export/publication"; scopes are "never
  widened by silence".

**The product owner chose full-fidelity, admin-gated.** A backup that silently drops
a member's private memory is not a backup, and a Sphere that cannot be restored is
not portable.

### Honest record of the tension

This choice is in tension with **invariant 9** ("supervision is not total
surveillance — governance must not automatically expose all private conversations")
and `privacy-model` §Minor privacy: whoever holds the export file can read a minor's
private memory, which no in-product policy check would have permitted them to read.
This RFC does not pretend otherwise.

It is a tension, not a plain contract violation, because:

- **Invariant 1** explicitly names "**exports**" among the artifacts that "belong to
  the users **or Spheres** that created them" — a Sphere-level export is contemplated
  by the contract, not foreign to it.
- Invariant 9 forbids *automatic* exposure. This is an explicit, adult-only,
  approval-gated, audited action — the opposite of automatic.
- **Invariant 21** ranks "safety, consent, privacy, minor protection **or data
  integrity**" above convenience. Restore fidelity *is* data integrity, so both the
  privacy and the portability sides of this decision live inside invariant 21; it
  does not settle the question on its own.

### Mitigations (what keeps this from being surveillance-by-backup)

- **Adult-only** (`allowedProfiles: ["adult"]`) — a minor cannot export.
- **Approval floor** (`approvalFloor: true`, `risk: "critical"`) — an export always
  requires a human approval, and the core's **no-self-approval** rule means a lone
  adult cannot silently export a Sphere containing another member's private memory.
  In a two-adult family, exporting the child's private memory takes both adults,
  deliberately.

  > **This mitigation was verified, and found broken.** Implementing this RFC
  > surfaced a pre-existing hole: `no-self-approval` matches the approver against
  > `requestedBy.onBehalfOf`, which `beginSensitiveAction` only populated when the
  > subject carried a `memberId` — and the API requires only `role` + `ageProfile`.
  > A subject omitting `memberId` was therefore *anonymous*, the check silently
  > could not fire, and the same caller could raise an export and grant it
  > themselves, walking away with every member's private memory. This defeated
  > separation of duties for **every** approval-gated capability
  > (`payment.execute`, `memory.share`, …), not just export. Fixed as part of this
  > RFC: an approval-gated action now requires an identified requester (member or
  > agent), and a grant on an unidentified request is refused (defence in depth).
  > Both paths are regression-tested. Had this shipped unfixed, the mitigation
  > above would have been decorative.
- **Audited** — the export is an audit fact (actor, capability, decision,
  correlation id). The snapshot itself never enters audit (audit minimality).
- **Local backup only** — the payload is returned to the caller. This RFC does not
  implement, and must not be read as authorizing, external transfer.

## Proposal

- **Capability** `sphere.export` in the catalog: `risk: "critical"`,
  `allowedProfiles: ["adult"]`, `approvalFloor: true`, auditing actor/capability/
  decision/correlation id.
- **Handler** (app layer): loads the Sphere snapshot and returns it as the capability
  output. No new endpoint — it runs through the existing governed pipeline
  (`POST /spheres/:id/capabilities/sphere.export/execute`), so policy, the approval
  floor, approval resolution and audit all apply unchanged. The snapshot returns on
  the approval-grant response, exactly like any other approval-gated action.
- **Console**: an Export control in the Sphere page that triggers the governed
  capability and downloads the returned JSON. It shows the approval outcome; it
  decides nothing.

## Domain impact

One new capability in the catalog. `SphereExport` / `exportSphere` are unchanged —
this RFC only *calls* them. No memory, policy or entity change. Notably the export
format already excludes embeddings (derived and regenerable), so a restore rebuilds
them.

## Security and privacy impact

- **The export contains private memory.** This is the deliberate decision above, with
  its tension recorded rather than hidden. Whoever holds the file holds that content.
- **Deny by default preserved**: non-adult profiles are denied by the catalog floor;
  an export with no allowing policy is denied like any capability.
- **Approval + no-self-approval** prevent a unilateral export by one adult.
- **Audit minimality preserved**: the snapshot is never written to audit.
- **No external transfer**: `external_transfer.*` remains unimplemented. Any future
  path that sends an export off the local environment is a separate, stricter
  decision (`public_exportable` + a final policy check) and must not reuse this
  capability.

## Alternatives considered

- **Scope-respecting export** (only what the requester may read). Rejected by the
  product owner: restore becomes lossy, so §17 portability is not met.
- **Two exports** (full local backup + a `public_exportable`-only external transfer).
  Rejected for now as unnecessary scope; external transfer is not being built, so the
  second half would be speculative. The distinction is preserved in this document so
  a future external-transfer RFC starts from the stricter rule.

## Open questions

- Should the export be encrypted at rest (an `FsEncryptedBlobStore`-style envelope)
  so the file is not a plaintext diary? Deferred — it does not change who may
  *obtain* it, which is what the approval gate governs.
- Should `privacy-model` §Scope transitions be amended to state that a governed
  full-Sphere backup is out of scope of `public_exportable`? Flagged: today that line
  reads as though only `public_exportable` items may ever leave.
- Import/restore as a governed capability (this RFC only exports).

## Acceptance criteria

- `sphere.export` exists in the catalog: critical, adult-only, approval floor.
- Executing it returns the complete documented snapshot as the capability output; a
  child is denied; a lone adult gets `pending_approval`, and the payload is returned
  only after a second adult grants.
- The snapshot never appears in audit.
- The exported payload round-trips through `importSphere` unchanged (fidelity).
- The console can trigger the export and download the result.
