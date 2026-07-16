/**
 * Local capability handlers (RFC-002/011/012/013).
 *
 * The concrete tools that `local`-runtime Capability Bindings resolve to —
 * downstream of the governance pipeline (the input is already authorized; a
 * handler is never an authorization point, coding principle 2).
 *
 * `calendar.*` and `memory.*` are real, Sphere-scoped adapters:
 *   - the calendar persists events (RFC-012);
 *   - notes capture/search/share canonical memory (RFC-013), with search
 *     policy-scoped per item by the ADR-002 resolver (`resolveReadableMemory`).
 * Both take their Sphere and acting subject from the governed ExecutionContext,
 * never from agent input, so an agent cannot reach another Sphere's or member's
 * data by supplying ids. The remaining handlers (messaging, payments) are still
 * synthetic stubs standing in for real adapters.
 *
 * Built as a factory over its dependencies so a test can assert every
 * store-catalog binding maps to a registered handler.
 */

import {
  createCalendarEvent,
  createMemoryItem,
  exportSphere,
  importSphere,
  resolveReadableMemory,
  shareWithMembers,
  type CalendarStore,
  type SphereStore,
} from "@kinos/core";
import type { CapabilityHandler } from "@kinos/executor-local";

export interface LocalHandlerDeps {
  readonly calendar: CalendarStore;
  /** Canonical memory + policies live in the Sphere snapshot (RFC-013). */
  readonly spheres: SphereStore;
  /** Injectable ids/time for deterministic tests; default to real ones. */
  readonly newEventId?: () => string;
  readonly newMemoryId?: () => string;
  readonly now?: () => string;
}

/** Tool name -> handler for the `local`-runtime bindings the store packages declare. */
export function buildLocalHandlers(deps: LocalHandlerDeps): Map<string, CapabilityHandler> {
  const newEventId = deps.newEventId ?? (() => `evt_${crypto.randomUUID()}`);
  const newMemoryId = deps.newMemoryId ?? (() => `mem_${crypto.randomUUID()}`);
  const now = deps.now ?? (() => new Date().toISOString());

  const requireCtx = <T>(context: T | undefined, what: string): T => {
    if (context === undefined) throw new Error(`${what} requires an execution context`);
    return context;
  };

  return new Map<string, CapabilityHandler>([
    // --- Calendar: a real, Sphere-scoped integration (RFC-012) --------------
    [
      "local.calendar_read",
      async (_input, _binding, context) => {
        const ctx = requireCtx(context, "calendar.read");
        return { events: await deps.calendar.listBySphere(ctx.sphereId) };
      },
    ],
    [
      "local.calendar",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "calendar.create_event");
        const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; start?: unknown };
        const createdBy = ctx.subject.memberId ?? ctx.subject.agentId;
        const event = createCalendarEvent({
          id: newEventId(),
          sphereId: ctx.sphereId, // scope from the governed context, never input
          title: typeof args.title === "string" ? args.title : "",
          start: typeof args.start === "string" ? args.start : now(),
          ...(createdBy !== undefined ? { createdBy } : {}),
          createdAt: now(),
        });
        await deps.calendar.create(event);
        return { created: true, event };
      },
    ],

    // --- Notes: real canonical memory (RFC-013) -----------------------------
    [
      "local.memory_capture",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "memory.capture");
        const ownerId = ctx.subject.memberId;
        if (ownerId === undefined) throw new Error("memory.capture requires a member subject to own the note");
        const args = (typeof input === "object" && input !== null ? input : {}) as { content?: unknown; summary?: unknown };
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const item = createMemoryItem({
          id: newMemoryId(),
          ownerId, // owned by the acting subject, from the governed context
          ownerType: "member",
          sphereId: ctx.sphereId,
          content: typeof args.content === "string" ? args.content : "",
          source: "manual",
          now: now(),
          ...(typeof args.summary === "string" ? { summary: args.summary } : {}),
        });
        await deps.spheres.save(exportSphere({ ...imported, memory: [...imported.memory, item], exportedAt: now() }));
        // Security fact only; the note content is never returned to audit here.
        return { captured: true, id: item.id, visibility: item.visibility };
      },
    ],
    [
      "local.memory_search",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "memory.search");
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) return { items: [] };
        const imported = importSphere(snap);
        // Policy-scoped retrieval (ADR-002): only what this subject may read.
        const readable = resolveReadableMemory(ctx.subject, imported.memory, imported.policies, {
          sphereId: ctx.sphereId,
          time: ctx.time,
          correlationId: ctx.correlationId,
        });
        const q = (typeof input === "object" && input !== null ? (input as { query?: unknown }).query : undefined);
        const query = typeof q === "string" ? q.trim().toLowerCase() : "";
        const matched = query === ""
          ? readable
          : readable.filter((m) => `${m.content} ${m.summary ?? ""}`.toLowerCase().includes(query));
        return { items: matched.map((m) => ({ id: m.id, content: m.content, visibility: m.visibility })) };
      },
    ],
    [
      "local.memory_share",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "memory.share");
        const grantedBy = ctx.subject.memberId ?? ctx.subject.agentId;
        if (grantedBy === undefined) throw new Error("memory.share requires an acting subject");
        const args = (typeof input === "object" && input !== null ? input : {}) as { itemId?: unknown; memberIds?: unknown };
        if (typeof args.itemId !== "string") throw new Error("memory.share requires an itemId");
        const subjectIds = Array.isArray(args.memberIds) ? args.memberIds.filter((x): x is string => typeof x === "string") : [];
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const item = imported.memory.find((m) => m.id === args.itemId);
        if (item === undefined) throw new Error(`Memory item ${args.itemId} not found`);
        const shared = shareWithMembers(item, { subjectIds, grantedBy, now: now() });
        const memory = imported.memory.map((m) => (m.id === item.id ? shared : m));
        await deps.spheres.save(exportSphere({ ...imported, memory, exportedAt: now() }));
        return { shared: true, itemId: item.id, visibility: shared.visibility };
      },
    ],

    // --- Synthetic demo stubs (stand-ins for real adapters) -----------------
    ["local.message", async (input) => ({ sent: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
  ]);
}
