/**
 * Local demo capability handlers (RFC-002/011).
 *
 * These are the concrete tools that `local`-runtime Capability Bindings resolve
 * to — the "how a capability runs" side, downstream of the governance pipeline
 * (the input is already authorized; a handler is never an authorization point,
 * coding principle 2). Each store-catalog package that provides a runtime tool
 * binds its capabilities to one of these names.
 *
 * They return synthetic data and touch nothing real: they stand in for genuine
 * integration adapters (a real calendar/notes/messaging/payments MCP) so the
 * governed tool loop is exercisable end-to-end without external side effects.
 * Swapping a real adapter in later changes no policy, memory, or token.
 *
 * Kept in one exported map so a test can assert every store-catalog binding maps
 * to a registered handler — otherwise a package could "enable" yet fail at the
 * first tools/call with "no local handler".
 */

import type { CapabilityHandler } from "@kinos/executor-local";

/** Tool name -> handler, for `local`-runtime bindings the store packages declare. */
export const localCapabilityHandlers: ReadonlyMap<string, CapabilityHandler> = new Map<string, CapabilityHandler>([
  // Calendar (family-calendar).
  ["local.calendar", async (input) => ({ created: true, input })],
  ["local.calendar_read", async (input) => ({ events: [{ title: "Family dinner", start: "2026-07-18T19:00:00Z" }], input })],
  // Notes / memory (family-notes).
  ["local.memory_search", async (input) => ({ hits: [{ id: "mem_1", snippet: "Dentist appointment moved to Friday." }], input })],
  ["local.memory_share", async (input) => ({ shared: true, input })],
  // Messaging (household-messaging).
  ["local.message", async (input) => ({ sent: true, input })],
  // Payments (household-payments).
  ["local.pay", async (input) => ({ paid: true, input })],
  // Generic echo (test/dev).
  ["local.echo", async (input) => ({ echoed: input })],
]);
