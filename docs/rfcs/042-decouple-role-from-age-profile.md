# RFC-042 — Decouple governance role from age profile

## Status

Accepted

## Summary

A Member's `role` currently conflates two orthogonal things: **governance
authority** (who may administer, who may approve) and **age/supervision**
(adult/teen/child, which drives minor-safety floors). The role vocabulary —
`parent | teenager | child | guest` — is family-specific, and a member's age
profile is *derived* from it (`ageProfileForRole`). KinOS governs any Sphere
(person, family, team, organization, school, association, institution), so make the
two independent: a **generic governance role** (`admin | member | guest`) plus an
**explicit age profile** on the Member (`adult | teen | child`). The Policy Engine
is already decoupled (a `subjectSelector` matches on `roles` and `ageProfiles`
separately; the capability floor keys on age, approver eligibility keys on role) —
this change removes the coupling that remains only at the Member/identity layer.
Legacy roles keep working (mapped on import) so existing Spheres and exports load
unchanged.

## Motivation

- **Governance ≠ family.** For a team or school, "parent/child" roles are wrong;
  you want `admin`/`member`. Age-based safety (a minor is restricted) is a separate
  concern that also applies (a school has minors), and must not be encoded in the
  governance role.
- **Age should be a property of the person, not their authority.** Deriving age
  from role means you cannot express "an adult ordinary member" or "a teen who is a
  Sphere admin" — both legitimate. An explicit `ageProfile` on the Member fixes
  this; the role says what they may govern, the age profile says what safety floor
  applies.
- The engine already supports it: `subjectSelector.{roles,ageProfiles}` are
  independent, `Capability.allowedProfiles` is age, `approverRoles` is role. Only
  the Member entity and the `ageProfileForRole` derivation couple them.

## Proposal

### Domain

1. **`Member` gains an explicit `ageProfile: AgeProfile`** (`adult | teen | child`).
   It is the person's supervision profile, independent of `role`. `createSphere`/
   `addMember`/founder input accept it; it defaults to `adult` when omitted.

2. **Generic governance roles.** `Role` becomes `admin | member | guest`, with the
   legacy `parent | teenager | child` accepted as **deprecated input aliases** that
   normalize on creation/import:
   - `parent → role admin, ageProfile adult`
   - `guest → role guest, ageProfile adult`
   - `teenager → role member, ageProfile teen`
   - `child → role member, ageProfile child`
   New Spheres use `admin | member | guest`. `admin` is the authority role (was
   `parent`); `member` is an ordinary participant; `guest` is limited.

3. **`effectiveAgeProfile(member)`** = `member.ageProfile ?? ageProfileForRole(
   legacyRole)`. The explicit field wins; the derivation survives only as the
   import fallback for a pre-migration Member/snapshot that has no `ageProfile`.
   Every place that builds a policy subject uses the member's explicit age profile,
   not a role-derived one.

4. **Seed policies + defaults key on `admin`.** `DEFAULT_ADMIN_ROLES = ["admin"]`;
   the founder defaults to `role admin`; package/approval presets that named
   `parent` as approver name `admin`. Legacy Spheres whose admin policies say
   `parent` keep working because `parent` normalizes to `admin` on import and the
   admin-seed backfill already re-grants by lineage.

### Import / backward compatibility

`importSphere`/member construction normalize a legacy `role` to `{role, ageProfile}`
when the Member has no explicit `ageProfile`. So a snapshot written before this RFC
restores with `parent`→admin/adult etc. — no data migration, no policy change; the
governed behaviour is identical (an old "parent" was admin + adult, which is exactly
what the normalization yields).

### UI

The member/role pickers offer `admin | member | guest` and, separately, an age
profile (`adult | teen | child`). Copy stops implying family. Approver/role labels
read "admin", "member", "guest".

## Domain impact

`Member` gains `ageProfile`; `Role` becomes the generic set with legacy aliases
normalized at the boundary; `ageProfileForRole` is retained as the import fallback;
`DEFAULT_ADMIN_ROLES` and founder/approer defaults move to `admin`. The Policy
Engine, capability floors, approval flow, and audit are unchanged — they already key
on the right dimension. Domain docs (`domain-model.md`, sphere-model ADR) updated to
describe role and age profile as independent Member attributes.

## Security and privacy impact

- **No authority change.** The normalization preserves exactly what each legacy role
  meant (parent = admin+adult, child = member+child, …). Minor-safety floors still
  key on `ageProfile`, now explicit and therefore *more* accurate (a minor can no
  longer be accidentally treated as an adult by giving them an admin-ish role, nor
  an adult restricted by an age-named role).
- **Deny-by-default preserved.** An unknown role is still denied; a missing
  `ageProfile` defaults to the *most-restrictive-safe* interpretation on the write
  path (explicit `adult` only when set), and to the legacy derivation on import.
- **Invariant 8 (minors restricted) is strengthened.** Age is now a first-class,
  explicit fact rather than an inference, so the floor can never be bypassed by role
  naming.
- **Auditable, reversible.** Roles/age profiles are Member attributes carried in the
  export; changing them is a governed member update, inspectable and revocable.

## Alternatives considered

- **Keep deriving age from role, just rename roles.** Rejected — it re-creates the
  coupling under new names and still can't express "adult member" / "teen admin".
- **Big-bang rename with no legacy aliases.** Rejected — it breaks every existing
  Sphere/export and all fixtures at once. Normalizing legacy roles on import is
  safer and lets old snapshots restore unchanged.
- **A separate "capabilities per role" table.** Out of scope — authority is already
  expressed by policies selecting on roles; this RFC only splits the Member's two
  conflated attributes.

## Acceptance criteria

- `Member` carries an explicit `ageProfile`; a subject's age profile comes from it,
  not from the role.
- New Spheres use `admin | member | guest`; the founder is `admin`.
- A legacy role (`parent`/`teenager`/`child`/`guest`) on member creation or on
  import normalizes to the right `{role, ageProfile}` and yields identical governed
  behaviour; a pre-RFC export restores unchanged.
- Seed admin policies and approver defaults key on `admin`; a legacy Sphere whose
  policies say `parent` still authorizes its admin.
- Minor-safety floors key on the explicit `ageProfile`; invariant 8 holds.
- The console offers role and age profile as independent fields with group-neutral
  copy.
- Verified: create a Sphere with an `admin` founder + a teen `member`, confirm the
  member's age floor applies independent of role; restore a pre-RFC snapshot and
  confirm identical behaviour.
