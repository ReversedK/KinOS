# RFC-012 — Execution Context for Capability Handlers, and a Reference Local-First Calendar Integration

## Status

Accepted (2026-07-16)

## Summary

Two coupled changes:

1. **Execution context for handlers.** Extend the `CapabilityExecutor` port so a
   handler receives the **governed execution context** — the Sphere id, the acting
   subject, the correlation id — alongside its input and binding. Today a handler
   sees only `(input, binding)`, so it cannot know *which Sphere* or *which actor*
   it runs for without trusting agent-supplied input — an isolation hole for any
   stateful integration. The context is descriptive and already-authorized; a
   handler still never makes an authorization decision (coding principle 2).

2. **A reference local-first calendar integration.** Replace the synthetic
   `local.calendar_read` / `local.calendar` demo stubs behind the `family-calendar`
   package with a real, persistent, **Sphere-scoped** calendar backed by SQLite.
   This is the first genuine integration adapter: it *implements* the `calendar.*`
   capabilities and defines no permissions, and swapping it in changes no policy,
   memory, or token — the "boring swap" made concrete.

The change is **additive**: the new context parameter is optional, so every
existing handler and the single call site keep working unchanged.

## Motivation

RFC-011 made the governed tool loop demonstrable, but every tool behind it returns
synthetic data. To move from "demonstrable" to "real", an integration must touch
real state — and the moment it does, it must be **Sphere-scoped**: agent A in
Sphere X must never read Sphere Y's calendar. The sphere id cannot come from the
`tools/call` arguments (the agent would be trusting itself); it must come from the
**governed context** — the token→Sphere binding the Sphere MCP already resolved.
The executor gives handlers no access to that context today, so a correct stateful
adapter is impossible to write. This RFC closes that gap, then proves it with a
real adapter.

## Proposal

### 1. `ExecutionContext` threaded to the executor and handler

A new domain type carries the already-decided facts a handler may need:

```ts
interface ExecutionContext {
  readonly sphereId: string;
  readonly subject: PolicyRequest["subject"]; // acting member/agent, role, ageProfile
  readonly correlationId: string;
  readonly execution: "local" | "cloud";
  readonly time: string;
}
```

- `CapabilityExecutor.execute(binding, input, context?)` gains an **optional** third
  parameter. `executeCapability` (the single call site) passes the context it
  already holds on `request`. Both execution paths — direct and post-approval —
  route through `executeCapability`, so one change covers both.
- `CapabilityHandler` becomes `(input, binding, context?) => Promise<unknown>`.
  Existing handlers ignore the parameter and are unaffected.

The context is **not** an authorization input. It reports decisions already made
upstream (who, which Sphere, which correlation); a handler must never branch on it
to grant or widen access — that stays the Policy Engine's job, upstream of the
executor (invariant: the runtime is a second line of defence, not the first).

### 2. Reference calendar integration

- **Core** (`calendar/calendar.ts`): a pure `CalendarEvent`, a `CalendarStore`
  port (`create`, `listBySphere`), a `createCalendarEvent` validator, and an
  `InMemoryCalendarStore` for tests. No I/O, no provider.
- **Adapter** (`persistence-sqlite`): `SqliteCalendarStore` — a `calendar_events`
  table keyed by id with a `sphere_id` column; `listBySphere` filters on it, so a
  Sphere only ever sees its own events.
- **App**: the `local.calendar_read` / `local.calendar` handlers become
  store-backed, reading `context.sphereId` (never agent input) for scope and
  `context.subject` for `createdBy`. The `family-calendar` manifest, its bindings,
  its grant presets, and the Policy Engine are **unchanged** — the swap is invisible
  to governance.

Other demo handlers (memory, messaging, payments) stay synthetic stubs; this RFC
delivers one real adapter as the reference pattern, not a fleet.

## Domain impact

- New `ExecutionContext` type; `CapabilityExecutor.execute` and `CapabilityHandler`
  gain an optional context parameter (additive).
- New `calendar/` core module (`CalendarEvent`, `CalendarStore`,
  `createCalendarEvent`, `InMemoryCalendarStore`), exported from the barrel.
- New `SqliteCalendarStore` adapter.
- No change to the capability catalog, the store manifests, the Policy Engine, the
  projection/Sphere-MCP contracts, tokens, or memory.

## Security and privacy impact

- **Sphere isolation is strengthened, not weakened.** Scope comes from the governed
  context (the token's Sphere), never from agent-supplied `tools/call` arguments, so
  an agent cannot read or write another Sphere's calendar by lying about a sphere id.
- **The handler is still not the authorization boundary.** The context is
  descriptive; the Policy Engine has already allowed (or suspended) the call before
  the handler runs. A compromised handler can misuse only its own Sphere's calendar,
  the same blast radius as any bound tool.
- **Real data, minimal footprint.** The calendar stores events (title, start,
  creator) — ordinary Sphere content in its own table, not audit and not canonical
  memory. No secrets, no external transfer (local-first).

## Alternatives considered

- **Pass the Sphere id inside the `tools/call` input.** Rejected: the agent would be
  trusted to name its own Sphere — a cross-Sphere isolation hole. Scope must come
  from the governed context.
- **A required (non-optional) context parameter.** Rejected: it would force a change
  to every existing handler and every test constructing one, for no benefit; optional
  is additive and equally correct.
- **A full `Integration` entity + lifecycle for the calendar.** Deferred: the
  store-backed handler already is the adapter that implements the capability; the
  entity plumbing (registration, scopes UI) is a separate slice.
- **An external calendar (Google/CalDAV).** Rejected for now: needs credentials and
  external transfer; a KinOS-native local-first calendar is more aligned with the
  product and self-contained. An external adapter can implement the same capabilities
  later with no policy change.

## Open questions

- Should `calendar.read` accept a time-range argument (agent input) while scope stays
  governed? (Input filtering is safe; scope is not.)
- Event mutation/deletion capabilities (`calendar.update_event`, `calendar.delete`)
  and their risk tiers.
- Whether the reference adapter graduates into a first-class `Integration` entity.

## Acceptance criteria

- A handler can read the acting Sphere id and subject from an execution context it
  did not have before; existing handlers compile and behave unchanged (additive).
- `family-calendar`'s `calendar.create_event` (after approval) persists a real event
  and `calendar.read` returns it — a genuine round-trip through the governed loop,
  with no manifest or policy change.
- Events are Sphere-scoped: a second Sphere's `calendar.read` never returns the
  first Sphere's events.
- Scope derives from the governed context, never from `tools/call` arguments.
