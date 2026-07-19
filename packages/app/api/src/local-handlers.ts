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
  createSphereProject,
  exportSphere,
  importSphere,
  resolveReadableMemory,
  revokeShare,
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
  readonly newProjectId?: () => string;
  readonly now?: () => string;
}

/**
 * A deterministic extractive summary (RFC-029 MVP): the first sentences up to a
 * bound, no model call. A real summarizer is a later binding — the capability
 * and its governance are unchanged when it is swapped in.
 */
function extractiveSummary(content: string, maxChars = 240): string {
  const text = content.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  // Prefer a sentence boundary within the bound; else fall back to a word break.
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (lastStop >= maxChars * 0.5) return clipped.slice(0, lastStop + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}

/** Tool name -> handler for the `local`-runtime bindings the store packages declare. */
export function buildLocalHandlers(deps: LocalHandlerDeps): Map<string, CapabilityHandler> {
  const newEventId = deps.newEventId ?? (() => `evt_${crypto.randomUUID()}`);
  const newMemoryId = deps.newMemoryId ?? (() => `mem_${crypto.randomUUID()}`);
  const newProjectId = deps.newProjectId ?? (() => `prj_${crypto.randomUUID()}`);
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

    [
      "local.memory_revoke",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "memory.revoke_share");
        const actor = ctx.subject.memberId;
        if (actor === undefined) throw new Error("memory.revoke_share requires a member subject");
        const args = (typeof input === "object" && input !== null ? input : {}) as { itemId?: unknown; memberId?: unknown };
        if (typeof args.itemId !== "string" || typeof args.memberId !== "string") {
          throw new Error("memory.revoke_share requires an itemId and a memberId");
        }
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const item = imported.memory.find((m) => m.id === args.itemId);
        if (item === undefined) throw new Error(`Memory item ${args.itemId} not found`);
        // Owner-only: only the note's owner may withdraw a share of it.
        if (!(item.ownerType === "member" && item.ownerId === actor)) {
          throw new Error("Only the note owner may revoke a share");
        }
        const revoked = revokeShare(item, { subjectId: args.memberId, now: now() });
        const memory = imported.memory.map((m) => (m.id === item.id ? revoked : m));
        await deps.spheres.save(exportSphere({ ...imported, memory, exportedAt: now() }));
        // Security fact only: the grant record is retained (revokedAt) as audit.
        return { revoked: true, itemId: item.id, member: args.memberId };
      },
    ],

    // --- Shared notes, projects & documents (RFC-029) -----------------------
    [
      // A shared Sphere note is canonical memory made shared_with_sphere — the
      // explicit, audited widening (private-by-default is never widened by
      // silence, ADR-002). Owned by the Sphere; readable by every member.
      "local.sphere_note_create",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "sphere.note.create");
        const args = (typeof input === "object" && input !== null ? input : {}) as { content?: unknown; summary?: unknown };
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const base = createMemoryItem({
          id: newMemoryId(),
          ownerId: ctx.sphereId, // the Sphere owns a shared note
          ownerType: "sphere",
          sphereId: ctx.sphereId,
          content: typeof args.content === "string" ? args.content : "",
          source: "manual",
          now: now(),
          ...(typeof args.summary === "string" ? { summary: args.summary } : {}),
        });
        // createMemoryItem defaults to private; a shared note is Sphere-visible.
        const note = { ...base, visibility: "shared_with_sphere" as const };
        await deps.spheres.save(exportSphere({ ...imported, memory: [...imported.memory, note], exportedAt: now() }));
        return { created: true, id: note.id, visibility: note.visibility };
      },
    ],
    [
      "local.sphere_project_create",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "sphere.project.create");
        const ownerId = ctx.subject.memberId ?? ctx.sphereId;
        const ownerType = ctx.subject.memberId !== undefined ? ("member" as const) : ("sphere" as const);
        const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; description?: unknown };
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const project = createSphereProject({
          id: newProjectId(),
          sphereId: ctx.sphereId,
          ownerId,
          ownerType,
          title: typeof args.title === "string" ? args.title : "",
          ...(typeof args.description === "string" ? { description: args.description } : {}),
          now: now(),
        });
        await deps.spheres.save(exportSphere({ ...imported, projects: [...imported.projects, project], exportedAt: now() }));
        return { created: true, id: project.id, title: project.title };
      },
    ],
    [
      // Documents = the Sphere's SHARED content. Read-only, policy-scoped, and
      // narrowed to shared_with_sphere so a private item is never returned here
      // (that is memory.search, which the owner alone reaches).
      "local.document_search",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "document.search");
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) return { documents: [] };
        const imported = importSphere(snap);
        const readable = resolveReadableMemory(ctx.subject, imported.memory, imported.policies, {
          sphereId: ctx.sphereId,
          time: ctx.time,
          correlationId: ctx.correlationId,
        }).filter((m) => m.visibility === "shared_with_sphere");
        const q = (typeof input === "object" && input !== null ? (input as { query?: unknown }).query : undefined);
        const query = typeof q === "string" ? q.trim().toLowerCase() : "";
        const matched = query === ""
          ? readable
          : readable.filter((m) => `${m.content} ${m.summary ?? ""}`.toLowerCase().includes(query));
        return { documents: matched.map((m) => ({ id: m.id, content: m.content, summary: m.summary })) };
      },
    ],
    [
      "local.document_summarize",
      async (input, _binding, context) => {
        const ctx = requireCtx(context, "document.summarize");
        const args = (typeof input === "object" && input !== null ? input : {}) as { documentId?: unknown };
        if (typeof args.documentId !== "string") throw new Error("document.summarize requires a documentId");
        const snap = await deps.spheres.load(ctx.sphereId);
        if (snap === undefined) throw new Error(`Sphere ${ctx.sphereId} not found`);
        const imported = importSphere(snap);
        const readable = resolveReadableMemory(ctx.subject, imported.memory, imported.policies, {
          sphereId: ctx.sphereId,
          time: ctx.time,
          correlationId: ctx.correlationId,
        });
        // Only a SHARED document is summarizable here — never a private item.
        const doc = readable.find((m) => m.id === args.documentId && m.visibility === "shared_with_sphere");
        if (doc === undefined) throw new Error(`Document ${args.documentId} not found`);
        return { id: doc.id, summary: doc.summary ?? extractiveSummary(doc.content) };
      },
    ],

    // --- Synthetic demo stubs (stand-ins for real adapters) -----------------
    ["local.message", async (input) => ({ sent: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
  ]);
}
