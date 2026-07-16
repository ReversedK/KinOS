/**
 * Local-first calendar (RFC-012) — the domain model behind the `calendar.*`
 * capabilities.
 *
 * A CalendarEvent is ordinary Sphere content: it lives in its own store, not in
 * canonical memory and not in the audit log. Every event belongs to exactly one
 * Sphere, and the store only ever returns a Sphere its own events — the isolation
 * boundary is the Sphere id, which callers take from the governed ExecutionContext
 * (RFC-012), never from agent-supplied input.
 *
 * Pure domain: no I/O, no provider. The persistence adapter implements
 * CalendarStore; the app handlers behind the capability bindings use it.
 */

export interface CalendarEvent {
  readonly id: string;
  readonly sphereId: string;
  readonly title: string;
  /** ISO timestamp of when the event starts. */
  readonly start: string;
  /** The member/agent id that created it (attribution, from the governed context). */
  readonly createdBy?: string;
  /** ISO timestamp of creation. */
  readonly createdAt: string;
}

export interface CreateCalendarEventInput {
  readonly id: string;
  readonly sphereId: string;
  readonly title: string;
  readonly start: string;
  readonly createdBy?: string;
  readonly createdAt: string;
}

/**
 * Validate and normalise a new event. Deny-by-default on missing essentials: a
 * blank title, Sphere or start is refused rather than stored as junk.
 */
export function createCalendarEvent(input: CreateCalendarEventInput): CalendarEvent {
  const title = input.title.trim();
  const start = input.start.trim();
  if (input.sphereId.trim() === "") throw new Error("A calendar event requires a Sphere");
  if (title === "") throw new Error("A calendar event requires a title");
  if (start === "") throw new Error("A calendar event requires a start time");
  return {
    id: input.id,
    sphereId: input.sphereId,
    title,
    start,
    ...(input.createdBy !== undefined && input.createdBy !== "" ? { createdBy: input.createdBy } : {}),
    createdAt: input.createdAt,
  };
}

/**
 * Persistence port. `listBySphere` MUST return only the given Sphere's events —
 * the store is the isolation boundary between Spheres.
 */
export interface CalendarStore {
  create(event: CalendarEvent): Promise<void>;
  listBySphere(sphereId: string): Promise<readonly CalendarEvent[]>;
}

/** In-memory CalendarStore for tests and local dev. */
export class InMemoryCalendarStore implements CalendarStore {
  private readonly events: CalendarEvent[] = [];

  async create(event: CalendarEvent): Promise<void> {
    this.events.push(event);
  }

  async listBySphere(sphereId: string): Promise<readonly CalendarEvent[]> {
    return this.events
      .filter((e) => e.sphereId === sphereId)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
}
