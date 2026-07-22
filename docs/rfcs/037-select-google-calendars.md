# RFC-037 — Select which Google calendars an integration uses

## Status

Accepted

## Summary

Let an admin choose **which** of a connected Google account's calendars an
integration reads and writes, instead of always using `primary`. Add a per-provider
`config` on the Integration (non-secret), a discovery endpoint that lists the
account's calendars, a picker in the Connectors screen, and make the Google Calendar
provider honour the selected calendar ids (read across all selected, create in the
first). Which calendars is a *config* choice, not a capability grant — every
`calendar.*` call is still policy-checked.

## Motivation

A Google account usually has several calendars (personal, family, work, shared). The
provider hardcodes `calendars/primary/events`, so a family cannot point KinOS at
their shared "Family" calendar, or read across two. Selecting the authorized
calendars is basic, expected configuration for a real calendar integration.

## Proposal

1. **`Integration.config`** — an optional `config?: Readonly<Record<string, unknown>>`
   carried on the entity and export (JSON, non-secret). Provider-specific and opaque
   to the domain (integrations are adapters). For Google Calendar:
   `config.calendarIds: string[]`.

2. **`integration.configure` accepts `config`.** Admin-gated (unchanged); merges the
   given config. Calendar ids are not secrets, so no reference indirection — but the
   endpoint still refuses a raw *credential* value in `secretRef` as before.

3. **Provider ctx carries `config`.** `IntegrationProviderCtx` gains
   `config?: Record<string, unknown>`; the executor passes `integration.config`.

4. **Google Calendar provider honours the selection.**
   - `calendar.read`: read from each id in `config.calendarIds` (default
     `["primary"]`), merge the events, tag each with its source calendar.
   - `calendar.create_event`: create in the first selected calendar (default
     `primary`); an explicit `calendarId` in the call input still wins.
   - A discovery op `calendar.list_calendars`: `GET users/me/calendarList` →
     `{ calendars: [{ id, summary, primary, accessRole }] }`.

5. **Discovery endpoint.** `GET /spheres/:id/integrations/:iid/calendars` —
   admin-gated (same floor/policy as `integration.configure`). It resolves the
   connected account's token via the broker and lists the calendars for the picker.
   It works on a connected integration regardless of enabled status (config precedes
   enable). Provider must support discovery (Google) — else `400`.

6. **UI.** For a connected Google Calendar integration, the Connectors screen shows a
   "Calendars" checklist (from the discovery endpoint); saving calls `configure` with
   the chosen `calendarIds`. Read-only accounts still list; the picker is for which to
   *use*.

## Domain impact

One optional `config` field on `Integration`/`createIntegration` and the export
(backward-compatible, defaults absent). No new capability, policy, event, or approval
— `calendar.read`/`calendar.create_event` are unchanged and still governed. The
discovery endpoint reuses the existing admin gate.

## Security and privacy impact

- **Config, not authority.** Selecting calendars changes *where* an authorized
  `calendar.*` call operates, never *whether* it is allowed — the Policy Engine still
  gates each call. Reading more calendars is still `calendar.read`, policy-checked.
- **Non-secret config.** Calendar ids are identifiers, not credentials — stored in
  the clear on the entity/export like scopes. No token is ever stored (RFC-018); the
  discovery endpoint fetches a fresh token per call via the broker and returns only
  calendar ids/names.
- **Admin-gated discovery.** Listing calendars is gated like `integration.configure`
  (admin, adult); it cannot be triggered by an agent. Deny-by-default: an
  unconnected integration (no account) or a non-Google provider is refused.
- **No scope change.** The calendar OAuth scope (RFC-032) already covers the
  account's calendars; selection narrows *use*, not consent.

## Alternatives considered

- **A dedicated `config` capability/entity.** Rejected — provider config is an
  attribute of the integration; a parallel entity adds lifecycle with no benefit.
- **Store selection in `scopes`.** Rejected — `scopes` are OAuth scopes; overloading
  them conflates consent with configuration. A distinct `config` keeps them separate.
- **Read all calendars always.** Rejected — it ignores the user's intent (they may
  want only the family calendar) and can flood results; explicit selection with a
  `primary` default is least-surprise.
- **Per-call `calendarId` only (no stored selection).** Rejected — the agent
  shouldn't have to know calendar ids; the admin configures the surface once. A
  per-call override is still honoured for flexibility.

## Acceptance criteria

- `GET …/integrations/:iid/calendars` on a connected Google Calendar integration
  lists the account's calendars (id + name); a non-Google or unconnected integration
  is refused; an agent cannot call it (admin-gated).
- `integration.configure` with `config.calendarIds` persists the selection; the
  summary reflects it; it is not a secret.
- `calendar.read` returns events from exactly the selected calendars (default
  `primary` when none selected); `calendar.create_event` targets the first selected.
- The Connectors screen shows a calendar checklist and saves the selection.
- Verified live against the real connected Google account: list calendars, select a
  subset, and read events from exactly those.
