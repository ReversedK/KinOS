/**
 * Integration executor + provider registry (RFC-016 inc.2).
 *
 * Routes a capability call whose binding is `runtime: "custom"` to the external
 * service configured on the Sphere's Integration, rather than to in-process code.
 * It runs downstream of the governance pipeline (the Policy Engine already allowed
 * the call); it decides no authorization — it only resolves *how* the capability
 * runs, per integration-model.md.
 *
 * Resolution, deny-by-default at each step:
 *   - the binding names the Integration by id (`runtimeToolName`); unknown → refuse;
 *   - the Integration must be `enabled` — a disabled/proposed one refuses;
 *   - a provider other than the built-in `local` must be configured with a
 *     credential reference — unconfigured → refuse;
 *   - the provider must have a registered adapter — none → refuse (a real Google /
 *     CalDAV / Apple adapter is a drop-in registry entry).
 *
 * The `local` provider is the built-in reference: it reuses KinOS's own calendar
 * store, so a Sphere that wants a self-hosted calendar picks provider "local"
 * while another picks "google". The capability name is identical either way.
 *
 * Any other binding runtime is delegated to the wrapped executor unchanged, so
 * local handlers, provisioning and runtime-governance tools are untouched.
 */

import {
  createCalendarEvent,
  importSphere,
  type CalendarStore,
  type CapabilityBinding,
  type CapabilityExecutor,
  type ExecutionContext,
  type SphereStore,
} from "@kinos/core";

import type { SecretMaterial, SecretStore } from "./secret-store.js";
import { extractiveSummary, searchSharedDocuments, summarizeSharedDocument } from "./documents.js";

export interface IntegrationProviderCtx {
  readonly sphereId: string;
  readonly subject: ExecutionContext["subject"];
  /** The governed call's correlation id — threads a provider read into the chain. */
  readonly correlationId: string;
  /** Credentials secret-store reference for the configured provider (never a value). */
  readonly secretRef?: string;
  /**
   * Lazily resolve `secretRef` to real credential material via the secret store
   * (RFC-019), for non-OAuth providers. Returns `undefined` when there is no
   * reference, no store, or the reference is unknown — the adapter refuses on
   * `undefined` (deny-by-default). OAuth adapters ignore this and use the broker.
   */
  readonly secret: () => Promise<SecretMaterial | undefined>;
  readonly scopes: readonly string[];
  readonly now: () => string;
  readonly newId: () => string;
}

/** How a provider backs a capability. Real SaaS adapters implement this shape. */
export type IntegrationProviderAdapter = (
  capability: string,
  input: unknown,
  ctx: IntegrationProviderCtx,
) => Promise<unknown>;

/** The built-in `local` provider: KinOS's own calendar store (the reference adapter). */
export function localCalendarProvider(calendar: CalendarStore): IntegrationProviderAdapter {
  return async (capability, input, ctx) => {
    if (capability === "calendar.read") {
      return { events: await calendar.listBySphere(ctx.sphereId) };
    }
    if (capability === "calendar.create_event") {
      const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; start?: unknown };
      const createdBy = ctx.subject.memberId ?? ctx.subject.agentId;
      const event = createCalendarEvent({
        id: ctx.newId(),
        sphereId: ctx.sphereId,
        title: typeof args.title === "string" ? args.title : "",
        start: typeof args.start === "string" ? args.start : ctx.now(),
        ...(createdBy !== undefined ? { createdBy } : {}),
        createdAt: ctx.now(),
      });
      await calendar.create(event);
      return { created: true, event };
    }
    throw new Error(`The local provider does not implement '${capability}'`);
  };
}

/**
 * The `local` documents source (RFC-031): the Sphere's shared notes, read-only and
 * policy-scoped, reusing the one documents-source implementation (never a private
 * item). Built over the SphereStore; no external service.
 */
export function localDocumentsProvider(spheres: SphereStore): IntegrationProviderAdapter {
  return async (capability, input, ctx) => {
    const readCtx: ExecutionContext = {
      sphereId: ctx.sphereId,
      subject: ctx.subject,
      correlationId: ctx.correlationId,
      execution: "local",
      time: ctx.now(),
    };
    if (capability === "document.search") {
      const q = (typeof input === "object" && input !== null ? (input as { query?: unknown }).query : undefined);
      return searchSharedDocuments(spheres, readCtx, typeof q === "string" ? q : undefined);
    }
    if (capability === "document.summarize") {
      const args = (typeof input === "object" && input !== null ? input : {}) as { documentId?: unknown };
      if (typeof args.documentId !== "string") throw new Error("document.summarize requires a documentId");
      return summarizeSharedDocument(spheres, readCtx, args.documentId);
    }
    throw new Error(`The local documents provider does not implement '${capability}'`);
  };
}

/**
 * The built-in `local` provider (RFC-031): KinOS's own reference for whatever
 * capability is asked — `calendar.*` via the calendar store, `document.*` via the
 * Sphere's shared notes. This makes provider "local" uniform across integrations,
 * so a Documents integration set to `local` reuses the RFC-029 shared-notes source.
 */
export function localProvider(deps: { calendar: CalendarStore; spheres: SphereStore }): IntegrationProviderAdapter {
  const calendar = localCalendarProvider(deps.calendar);
  const documents = localDocumentsProvider(deps.spheres);
  return async (capability, input, ctx) => {
    if (capability.startsWith("calendar.")) return calendar(capability, input, ctx);
    if (capability.startsWith("document.")) return documents(capability, input, ctx);
    throw new Error(`The local provider does not implement '${capability}'`);
  };
}

/**
 * Google Drive provider (RFC-031): resolves a fresh access token from the auth
 * broker (the same OAuth path as the calendar provider) and calls the Drive API —
 * `files.list` full-text search for `document.search`, `files.export` (text/plain)
 * + an extractive summary for `document.summarize`. `fetchImpl` is injectable so
 * the broker→token→Drive wiring is testable without hitting Google. The HTTP calls
 * are the only provider-specific code.
 */
export function googleDriveProvider(
  broker: { getAccessToken(accountRef: string): Promise<string> },
  fetchImpl: typeof fetch = fetch,
): IntegrationProviderAdapter {
  const FILES = "https://www.googleapis.com/drive/v3/files";
  return async (capability, input, ctx) => {
    if (ctx.secretRef === undefined) throw new Error("Google Drive integration is not connected (no account)");
    const token = await broker.getAccessToken(ctx.secretRef);
    const auth = { Authorization: `Bearer ${token}` };
    if (capability === "document.search") {
      const q = (typeof input === "object" && input !== null ? (input as { query?: unknown }).query : undefined);
      const query = typeof q === "string" ? q.trim() : "";
      // Read-only full-text search over the connected Drive, trashed files excluded.
      const driveQ = query === "" ? "trashed=false" : `fullText contains ${JSON.stringify(query)} and trashed=false`;
      const url = `${FILES}?q=${encodeURIComponent(driveQ)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=50`;
      const res = await fetchImpl(url, { headers: auth });
      if (!res.ok) throw new Error(`Google Drive search failed: ${res.status}`);
      const body = (await res.json()) as { files?: Array<{ id?: string; name?: string }> };
      return { documents: (body.files ?? []).map((f) => ({ id: f.id ?? "", content: f.name ?? "(untitled)" })) };
    }
    if (capability === "document.summarize") {
      const args = (typeof input === "object" && input !== null ? input : {}) as { documentId?: unknown };
      if (typeof args.documentId !== "string") throw new Error("document.summarize requires a documentId");
      const id = args.documentId;
      // Look up the file's type first: Drive's `export` only works for Google-native
      // docs (Docs/Sheets/Slides). A blind export 403s on PDFs, images, notebooks, etc.
      const metaRes = await fetchImpl(`${FILES}/${encodeURIComponent(id)}?fields=${encodeURIComponent("name,mimeType")}`, { headers: auth });
      if (!metaRes.ok) throw new Error(`Google Drive summarize failed: ${metaRes.status}`);
      const meta = (await metaRes.json()) as { name?: string; mimeType?: string };
      const mime = meta.mimeType ?? "";
      const name = meta.name ?? "(untitled)";
      // Google Docs/Slides → plain text; Sheets → CSV; a plain text file → download.
      const exportAs =
        mime === "application/vnd.google-apps.document" || mime === "application/vnd.google-apps.presentation"
          ? "text/plain"
          : mime === "application/vnd.google-apps.spreadsheet"
            ? "text/csv"
            : undefined;
      let text: string | undefined;
      if (exportAs !== undefined) {
        const r = await fetchImpl(`${FILES}/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportAs)}`, { headers: auth });
        if (r.ok) text = await r.text();
      } else if (mime.startsWith("text/")) {
        const r = await fetchImpl(`${FILES}/${encodeURIComponent(id)}?alt=media`, { headers: auth });
        if (r.ok) text = await r.text();
      }
      // A non-text document (PDF, image, folder, binary) can't be summarized as text —
      // say so gracefully rather than failing the call.
      if (text === undefined || text.trim() === "") {
        return { id, summary: `“${name}” (${mime || "unknown type"}) — not a text document; nothing to summarize.` };
      }
      return { id, summary: extractiveSummary(text) };
    }
    throw new Error(`The Google Drive provider does not implement '${capability}'`);
  };
}

/**
 * Google Calendar provider (RFC-017): resolves a fresh access token from the auth
 * broker (Better Auth — auto-refreshed) using the integration's account reference,
 * then calls the real Google Calendar API. The HTTP call is the only
 * provider-specific code; token acquisition is uniform across OAuth services.
 * `fetchImpl` is injectable so the broker→token→Authorization wiring is testable
 * without hitting Google.
 */
export function googleCalendarProvider(
  broker: { getAccessToken(accountRef: string): Promise<string> },
  fetchImpl: typeof fetch = fetch,
): IntegrationProviderAdapter {
  const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  return async (capability, input, ctx) => {
    if (ctx.secretRef === undefined) throw new Error("Google Calendar integration is not connected (no account)");
    const token = await broker.getAccessToken(ctx.secretRef);
    const auth = { Authorization: `Bearer ${token}` };
    if (capability === "calendar.read") {
      const res = await fetchImpl(`${CAL}?maxResults=50&singleEvents=true&orderBy=startTime`, { headers: auth });
      if (!res.ok) throw new Error(`Google Calendar read failed: ${res.status}`);
      const body = (await res.json()) as { items?: Array<{ id?: string; summary?: string; start?: { dateTime?: string; date?: string } }> };
      return {
        events: (body.items ?? []).map((e) => ({ id: e.id ?? "", title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date ?? "" })),
      };
    }
    if (capability === "calendar.create_event") {
      const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; start?: unknown };
      const start = typeof args.start === "string" ? args.start : ctx.now();
      const res = await fetchImpl(CAL, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ summary: typeof args.title === "string" ? args.title : "", start: { dateTime: start }, end: { dateTime: start } }),
      });
      if (!res.ok) throw new Error(`Google Calendar create failed: ${res.status}`);
      const body = (await res.json()) as { id?: string };
      return { created: true, event: { id: body.id ?? "", title: typeof args.title === "string" ? args.title : "", start } };
    }
    throw new Error(`The Google provider does not implement '${capability}'`);
  };
}

/** ISO-8601 → iCalendar UTC basic form: 2026-07-20T09:00:00Z → 20260720T090000Z. */
function toICalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * CalDAV provider (RFC-019) — the first real non-OAuth connector. Resolves Basic
 * credentials + the collection endpoint from the secret store, then speaks CalDAV to
 * the configured calendar. One adapter covers Apple iCloud, Nextcloud and Fastmail,
 * which all use CalDAV with an app-specific password. Deny-by-default: unresolved
 * credentials (or a missing endpoint) refuse the call — it never runs unauthenticated.
 *
 * `fetchImpl` is injectable so the auth + protocol wiring is testable without a live
 * CalDAV server. The HTTP calls are the only provider-specific code.
 */
export function caldavCalendarProvider(fetchImpl: typeof fetch = fetch): IntegrationProviderAdapter {
  return async (capability, input, ctx) => {
    const material = await ctx.secret();
    if (material === undefined || material.kind !== "basic") {
      throw new Error("CalDAV integration is not configured (no basic credentials resolved)");
    }
    const endpoint = material.endpoint;
    if (endpoint === undefined || endpoint === "") throw new Error("CalDAV integration has no collection endpoint");
    const base = endpoint.replace(/\/+$/, "");
    const authHeader = `Basic ${Buffer.from(`${material.username}:${material.password}`).toString("base64")}`;

    if (capability === "calendar.create_event") {
      const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; start?: unknown };
      const title = typeof args.title === "string" ? args.title : "";
      const start = typeof args.start === "string" ? args.start : ctx.now();
      const uid = ctx.newId();
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//KinOS//CalDAV//EN",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toICalDate(ctx.now())}`,
        `DTSTART:${toICalDate(start)}`,
        `DTEND:${toICalDate(start)}`,
        `SUMMARY:${title.replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n")}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const res = await fetchImpl(`${base}/${encodeURIComponent(uid)}.ics`, {
        method: "PUT",
        headers: { Authorization: authHeader, "content-type": "text/calendar; charset=utf-8" },
        body: ics,
      });
      if (!res.ok) throw new Error(`CalDAV create failed: ${res.status}`);
      return { created: true, event: { id: uid, title, start } };
    }

    if (capability === "calendar.read") {
      const body =
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
        "<d:prop><d:getetag/><c:calendar-data/></d:prop>" +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>' +
        "</c:calendar-query>";
      const res = await fetchImpl(base, {
        method: "REPORT",
        headers: { Authorization: authHeader, Depth: "1", "content-type": "application/xml; charset=utf-8" },
        body,
      });
      if (!res.ok) throw new Error(`CalDAV read failed: ${res.status}`);
      const text = await res.text();
      return { events: parseVEvents(text) };
    }

    throw new Error(`The CalDAV provider does not implement '${capability}'`);
  };
}

/** Pull id/title/start from each VEVENT in a CalDAV multistatus body (reference-grade). */
function parseVEvents(multistatus: string): Array<{ id: string; title: string; start: string }> {
  const events: Array<{ id: string; title: string; start: string }> = [];
  const blocks = multistatus.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const vevent = block.split("END:VEVENT")[0] ?? "";
    const field = (name: string): string => {
      // Match a property line, ignoring iCal parameters after the property name.
      const m = vevent.match(new RegExp(`\\n${name}(?:;[^:\\n]*)?:([^\\r\\n]*)`, "i"));
      return m?.[1]?.trim() ?? "";
    };
    events.push({ id: field("UID"), title: field("SUMMARY") || "(no title)", start: field("DTSTART") });
  }
  return events;
}

export interface IntegrationExecutorDeps {
  readonly spheres: SphereStore;
  /** provider id -> adapter. Built-in "local" + drop-in external providers. */
  readonly registry: ReadonlyMap<string, IntegrationProviderAdapter>;
  /** Resolves non-OAuth `secretRef`s (RFC-019). Absent → no material resolves. */
  readonly secrets?: SecretStore;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export class IntegrationExecutor implements CapabilityExecutor {
  constructor(
    private readonly fallback: CapabilityExecutor,
    private readonly deps: IntegrationExecutorDeps,
  ) {}

  async execute(binding: CapabilityBinding, input: unknown, context?: ExecutionContext): Promise<unknown> {
    if (binding.runtime !== "custom") return this.fallback.execute(binding, input, context);
    if (context === undefined) throw new Error("An integration capability requires an execution context");

    const snap = await this.deps.spheres.load(context.sphereId);
    if (snap === undefined) throw new Error(`Sphere ${context.sphereId} not found`);
    const integration = importSphere(snap).integrations.find((i) => i.id === binding.runtimeToolName);
    if (integration === undefined) throw new Error(`Integration '${binding.runtimeToolName}' not found`);
    if (integration.status !== "enabled") {
      throw new Error(`Integration '${integration.provider}' is not enabled`);
    }
    // External providers must be configured (credentials by reference); the
    // built-in local provider needs none.
    if (integration.provider !== "local" && integration.secretRef === undefined) {
      throw new Error(`Integration '${integration.provider}' is not configured (no credentials)`);
    }
    const adapter = this.deps.registry.get(integration.provider);
    if (adapter === undefined) {
      throw new Error(`No adapter installed for provider '${integration.provider}'`);
    }
    const secretRef = integration.secretRef;
    const secrets = this.deps.secrets;
    return adapter(binding.capability, input, {
      sphereId: context.sphereId,
      subject: context.subject,
      correlationId: context.correlationId,
      ...(secretRef !== undefined ? { secretRef } : {}),
      // Lazy: only a non-OAuth adapter that authenticates pays the lookup, and the
      // material is fetched at use and not retained on the context.
      secret: async () => (secretRef !== undefined && secrets !== undefined ? secrets.get(secretRef) : undefined),
      scopes: integration.scopes,
      now: this.deps.now ?? (() => new Date().toISOString()),
      newId: this.deps.newId ?? (() => `evt_${crypto.randomUUID()}`),
    });
  }
}
