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

export interface IntegrationProviderCtx {
  readonly sphereId: string;
  readonly subject: ExecutionContext["subject"];
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
