# RFC-010 — Full Sphere Administration, a Single Harness, and the Governed TUI

## Status

Accepted (2026-07-16)

## Summary

Three changes that all follow from the same confusion ADR-008 set out to fix —
the conflation of *Harness* (where an agent runs) with *inference provider* (what
generates tokens) — plus the administration gap that conflation left behind:

1. **Administration.** An administrator may administer *every* aspect of their
   Sphere. The RFC-008 admin seed is widened to the Sphere-settings capabilities
   (`runtime.set_provider`, `integration.*`, `package.*`) that it never covered,
   so an administrator was denied by default on their own Sphere.
2. **One Harness.** Hermes is the only Harness offered. The selectable
   "runtime" (`KINOS_RUNTIME=ollama|hermes`) and the `hermes` entry in the
   *provider* dropdown are removed. Ollama remains, unchanged, as an RFC-004
   inference **provider**.
3. **The governed TUI.** Real-condition agent testing becomes a terminal attached
   to the agent's own governed Hermes profile, replacing the direct-inference
   chat bench that ADR-008 §6 classified as test-mode.

## Motivation

**Administration.** `defaultAdminPolicies` seeded provisioning, runtime
governance and `model.set`, but the console also exposes connectors, the package
store and the inference provider/model. Those capabilities are policy-checked and
nothing granted them, so deny-by-default refused an administrator on their own
Sphere. The invariant is right and the seed was incomplete: the fix belongs in the
seed, not in a bypass.

**One Harness.** ADR-008 §3 already decided Hermes is the sole Harness, but the
code still offered a harness switch, and the console listed `hermes` beside
`ollama` and `openai` as if a Harness were a provider. That is precisely the
"misleading equation *governed = the Hermes profile*" ADR-008 rejects. It also had
a concrete cost: `GET /spheres/:id/runtime` reported the harness model from
`HARNESS_MODEL`/`KINOS_RUNTIME` **environment variables** rather than from the
governed profile — so the console could show a model KinOS had not decided.

**The governed TUI.** ADR-008 §6 named the gap honestly: `/chat` drove inference
directly and never exercised the Harness loop, so "test agents in real
conditions" tested something other than production. This closes the gap the ADR
authorized closing.

## Proposal

### 1. The admin seed covers Sphere settings

`IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES` = `runtime.set_provider`,
`integration.enable`, `integration.disable`, `package.install`, `package.enable`,
`package.disable`, seeded by `defaultAdminPolicies` as
`pol_<sphere>_admin_settings`.

This widens nothing structurally. It is an ordinary versioned, editable policy —
a seed, not a hidden privilege; delete or disable it and the ability goes. The
catalog's adult-only floor, the per-call policy check, and the cloud/consent path
on a cloud provider all still apply. Administration stays **role-based** (the
`Role` union is unchanged: no `admin` role is introduced; `DEFAULT_ADMIN_ROLES`
remains `["parent"]`).

### 2. Seed backfill is anchored on lineage

Spheres provisioned before a seed existed must not be locked out, so missing
seeds are backfilled at request time. The backfill is **anchored on the
`admin_provisioning` seed**: only a Sphere that still carries it — proving it was
created by RFC-008 provisioning and merely predates the newer seeds — is
backfilled. A Sphere with no policies is left denied by default; the backfill can
never fabricate authority where none existed.

It is applied wherever an admin capability is checked, including at **approval
grant time**. Without that, an action could be authorized, suspend for approval,
and then be denied when granted — an unresolvable approval.

### 3. Hermes is the sole Harness; provider/model is projected into it

- No harness selection exists: `KINOS_RUNTIME` is removed, the compose `hermes`
  profile gate is removed, and Hermes always runs.
- `hermes` is removed from the provider dropdown. Providers are `ollama · local`
  and `openai · cloud` (RFC-004), and the console can set the profile's
  `baseUrl`/`secretRef`.
- `GET /spheres/:id/runtime` reports `harness.runtime = "hermes"` with the
  **governed** provider/model, never env defaults. Only the Harness's own address
  stays deployment config.
- The governed profile (RFC-004/009) is projected into the agent's Hermes
  `model:` block, so the Harness runs on exactly what KinOS decided (ADR-008 §4).
  The adapter supplies two Hermes-specific facts the domain must not carry: a
  `/v1` suffix on an Ollama `base_url` (a bare `:11434` 404s) and
  `context_length: 65536` (Hermes refuses < 64K).
- `deploy/hermes/bootstrap.py` seeds only the container's *default* profile for
  first boot; a per-agent projected profile always wins.

### 4. The governed TUI

New capability **`runtime.session.attach`** (high risk, adult-only, no approval
floor), seeded to administrators.

```
browser ──POST /spheres/:id/agents/:aid/runtime/tui──▶ API
                                                        │ Policy Engine decides
                                                        ▼
                                          single-use ticket (60s TTL)
browser ──ws://<hermes>:8788?ticket=…──▶ TUI bridge (inside Hermes)
                                          │ POST /tui/redeem  → { agentId }
                                          ▼
                              pty: hermes chat --tui, HERMES_HOME=<profile>
```

- **The API is the authorization boundary.** The bridge decides nothing (ADR-008
  §5). It accepts only an opaque ticket, redeems it with KinOS, and is told an
  **agent id — never a path**, so a caller cannot name a directory.
- **The bridge runs inside the Hermes container**, not via `docker exec` from the
  API. Exec would require the docker socket in the component that *is* the
  authorization boundary, making an API compromise host-root. Hermes already
  ships `websockets`, and a PTY is a local concern, so KinOS keeps no host
  privilege at all.
- **A profile is a HERMES_HOME.** Profiles are independent `HERMES_HOME`
  directories (`hermes_cli/profiles.py`); Hermes selects one in
  `_apply_profile_override()` (pre-argparse) with this precedence: the
  `-p`/`--profile` flag, else a `HERMES_HOME` already pointing at a
  `.../profiles/<name>` dir (the bridge's path — trusted directly), else the
  sticky `active_profile` file. Setting `HERMES_HOME=<profile dir>` and passing
  `-p <name>` are equivalent per-invocation and neither mutates global state; the
  bridge uses the env form so it never depends on name resolution. The bridge
  refuses to *create* a profile — it can only open one KinOS itself projected,
  which is what keeps "governed profile" true.
- Profile directories are chowned to the Harness uid/gid on write, or Hermes
  cannot read its own profile.

## Domain impact

- **Capabilities:** `runtime.session.attach` added to the catalog and to
  `IN_SPHERE_RUNTIME_GOVERNANCE_CAPABILITIES`.
- **Provisioning:** `IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES` + the
  `admin_settings` seed policy.
- **Runtime:** `TuiTicket` / `TuiTicketStore` (pure domain; values minted by an
  injected CSPRNG). `defaultRuntimeConfig()` model is now `gemma4-128k`, matching
  the Harness default so a fresh Sphere projects a profile the Harness can run.
- **Audit:** new `runtime.session.attached` event.
- **Unchanged:** the `Role` union, memory, tokens (ADR-007), the Sphere MCP
  contract, and the RFC-004/009 model of who decides provider/model.

## Security and privacy impact

- **Attach is a governed, audited action.** The Policy Engine decides before a
  terminal exists; the audit records that an attach was authorized and that one
  happened — **never the ticket value**, and never session content.
- **Tickets** are high-entropy, single-use and 60s-lived; unknown, expired and
  replayed tickets are refused identically, so a refusal reveals nothing. They
  are in-memory: an attach ticket is not a durable fact.
- **Attaching is not authorizing.** The session runs as the agent and reaches
  capabilities only through the Sphere MCP, re-checked per call. It cannot widen
  its surface by editing the profile — KinOS owns the profile, the agent does not.
- **No host privilege is added.** No docker socket is mounted anywhere.
- **Residual risk (honest).** The bridge port is published for the browser, so
  the ticket is the boundary — the same posture ADR-007 records for the Sphere
  MCP, and it deserves the same hardening (private listener + proxy) before
  production. A minor can never attach (adult-only catalog floor). Anyone holding
  a live ticket for 60s gets that one agent's terminal.
- **Known limitation.** A seed an administrator *deleted* to revoke it is
  re-added by the backfill; disabling it (`status: "disabled"`) is the revocation
  that survives. This is tracked rather than hidden, and is why the backfill is
  lineage-anchored rather than unconditional.

## Alternatives considered

- **Add an `admin` role.** Rejected for now: `parent` already carries
  administration in the family case, and the `admin` strings in
  `FLOOR_APPROVER_ROLES` / `SUPERVISOR_ROLES` still work for a future role
  without a domain change. Widening the seed solves the reported problem with no
  new vocabulary.
- **Purge Ollama entirely.** Rejected: it would leave no local-first inference,
  contradicting RFC-004 and invariant 13. Ollama is not a Harness — it is a
  provider — and only the *harness* framing was wrong.
- **`docker exec` from the API over a mounted socket.** Rejected: host-root
  privilege in the authorization boundary, for no functional gain.
- **Terminal-styled chat over Hermes `/v1`.** Rejected: the api_server serves one
  active profile and its `model` field is cosmetic, so it cannot exercise the
  per-agent governed profile — the exact thing being tested.
- **`hermes dashboard`.** Rejected: it is a config/API-key editor; letting the
  agent's environment edit its own config violates KinOS owning the profile.
- **Unconditional seed backfill.** Rejected: it authorized a policy-less Sphere,
  breaking deny-by-default (caught by existing tests).

## Open questions

- Should the bridge listener move behind the API (private port + authenticated
  proxy) before any non-local deployment, alongside the ADR-007 hardening?
- Should `runtime.session.attach` carry an approval floor for a *minor's* agent,
  even though only adults can attach?
- Concurrency: two operators attaching to one agent share a profile's session
  state. Serialize, or allow it?
- **Verification gap (pre-existing, not RFC-010's to fix).** The governed loop's
  transport, per-agent token auth and policy-scoped tool *discovery* were verified
  live from the Hermes container (real projected token authenticates; forged/empty
  token → "Unauthenticated credential"; the MCP URL is `http://api:8787/…`, not
  `localhost`). A live `tools/call` could not be shown because **no governed
  endpoint creates a `CapabilityBinding` for a runtime tool** — `enablePackage`
  only flips a status flag — so every projected surface is empty and the
  projection's deny-by-default (unbound → not offered) leaves nothing to call. The
  execution half is covered by `e2e.test.ts` (token → list surface → execute a
  tool call, forged-token fail-closed). Wiring governed binding-creation (the
  package grant-wizard) is a separate slice. **Resolved by RFC-011**: enabling a
  package now emits an enabled binding + grant policy, so the full loop was
  verified live — from the Hermes container, `tools/call calendar.read` executes
  through the Policy Engine and returns a result, while `calendar.create_event`
  suspends for approval and a forged token is rejected.

## Acceptance criteria

- [x] An administrator (`parent`) can set the inference provider/model, manage
      connectors and manage packages on their own Sphere.
- [x] A Sphere with no policies is still denied by default; the backfill only
      applies to Spheres carrying the RFC-008 admin seed.
- [x] An approval granted later is evaluated against the same effective policy
      set the request was suspended under.
- [x] No harness selection exists in code, config or UI; `KINOS_RUNTIME` is gone
      and `hermes` is not offered as a provider.
- [x] `GET /spheres/:id/runtime` reports the sole Hermes Harness with the
      governed provider/model, not environment defaults.
- [x] The governed provider/model/base_url reaches the agent's Hermes profile
      (`model:` block) with a Hermes-valid `context_length` and `/v1` base URL.
- [x] Test agents opens a real terminal on the agent's governed profile; a minor
      is refused; a ticket cannot be replayed; the ticket value is never audited.
