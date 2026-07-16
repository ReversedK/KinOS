/**
 * Local capability handlers (RFC-002/011/012).
 *
 * The concrete tools that `local`-runtime Capability Bindings resolve to —
 * downstream of the governance pipeline (the input is already authorized; a
 * handler is never an authorization point, coding principle 2).
 *
 * `calendar.*` are backed by a real, Sphere-scoped CalendarStore (RFC-012): the
 * first genuine integration adapter. It takes the Sphere id from the governed
 * ExecutionContext, never from agent input, so an agent cannot reach another
 * Sphere's calendar. The remaining handlers (memory, messaging, payments) are
 * still synthetic stubs standing in for real adapters.
 *
 * Built as a factory over its dependencies so a test can assert every
 * store-catalog binding maps to a registered handler — otherwise a package could
 * "enable" yet fail at the first tools/call with "no local handler".
 */

import { createCalendarEvent, type CalendarStore } from "@kinos/core";
import type { CapabilityHandler } from "@kinos/executor-local";

export interface LocalHandlerDeps {
  readonly calendar: CalendarStore;
  /** Injectable id/time for deterministic tests; default to real ones. */
  readonly newEventId?: () => string;
  readonly now?: () => string;
}

/** Tool name -> handler for the `local`-runtime bindings the store packages declare. */
export function buildLocalHandlers(deps: LocalHandlerDeps): Map<string, CapabilityHandler> {
  const newEventId = deps.newEventId ?? (() => `evt_${crypto.randomUUID()}`);
  const now = deps.now ?? (() => new Date().toISOString());

  return new Map<string, CapabilityHandler>([
    // --- Calendar: a real, Sphere-scoped integration (RFC-012) --------------
    [
      "local.calendar_read",
      async (_input, _binding, context) => {
        if (context === undefined) throw new Error("calendar.read requires an execution context");
        const events = await deps.calendar.listBySphere(context.sphereId);
        return { events };
      },
    ],
    [
      "local.calendar",
      async (input, _binding, context) => {
        if (context === undefined) throw new Error("calendar.create_event requires an execution context");
        const args = (typeof input === "object" && input !== null ? input : {}) as { title?: unknown; start?: unknown };
        const event = createCalendarEvent({
          id: newEventId(),
          // Scope from the governed context, never from agent input (isolation).
          sphereId: context.sphereId,
          title: typeof args.title === "string" ? args.title : "",
          start: typeof args.start === "string" ? args.start : now(),
          ...(context.subject.memberId !== undefined ? { createdBy: context.subject.memberId } : context.subject.agentId !== undefined ? { createdBy: context.subject.agentId } : {}),
          createdAt: now(),
        });
        await deps.calendar.create(event);
        return { created: true, event };
      },
    ],

    // --- Synthetic demo stubs (stand-ins for real adapters) -----------------
    ["local.memory_search", async (input) => ({ hits: [{ id: "mem_1", snippet: "Dentist appointment moved to Friday." }], input })],
    ["local.memory_share", async (input) => ({ shared: true, input })],
    ["local.message", async (input) => ({ sent: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
  ]);
}
