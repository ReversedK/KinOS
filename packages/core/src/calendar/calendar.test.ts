import { describe, expect, it } from "vitest";

import { InMemoryCalendarStore, createCalendarEvent } from "./calendar.js";

const base = { id: "evt_1", sphereId: "sph_1", title: "Dentist", start: "2026-07-20T09:00:00Z", createdAt: "2026-07-16T10:00:00Z" };

describe("createCalendarEvent (RFC-012)", () => {
  it("normalizes and keeps the essentials + optional creator", () => {
    const e = createCalendarEvent({ ...base, title: "  Dentist  ", createdBy: "mbr_1" });
    expect(e).toMatchObject({ sphereId: "sph_1", title: "Dentist", start: "2026-07-20T09:00:00Z", createdBy: "mbr_1" });
  });

  it("omits an empty creator rather than storing a blank", () => {
    expect(createCalendarEvent({ ...base, createdBy: "" }).createdBy).toBeUndefined();
  });

  it("refuses a blank Sphere, title or start (deny-by-default on junk)", () => {
    expect(() => createCalendarEvent({ ...base, sphereId: " " })).toThrow(/Sphere/i);
    expect(() => createCalendarEvent({ ...base, title: "  " })).toThrow(/title/i);
    expect(() => createCalendarEvent({ ...base, start: "" })).toThrow(/start/i);
  });
});

describe("InMemoryCalendarStore (RFC-012)", () => {
  it("round-trips events for a Sphere, ordered by start", async () => {
    const store = new InMemoryCalendarStore();
    await store.create(createCalendarEvent({ ...base, id: "evt_2", start: "2026-07-21T09:00:00Z", title: "Later" }));
    await store.create(createCalendarEvent({ ...base, id: "evt_1", start: "2026-07-20T09:00:00Z", title: "Earlier" }));
    expect((await store.listBySphere("sph_1")).map((e) => e.title)).toEqual(["Earlier", "Later"]);
  });

  it("is the isolation boundary: one Sphere never sees another's events", async () => {
    const store = new InMemoryCalendarStore();
    await store.create(createCalendarEvent({ ...base, sphereId: "sph_A" }));
    expect(await store.listBySphere("sph_B")).toEqual([]);
    expect(await store.listBySphere("sph_A")).toHaveLength(1);
  });
});
