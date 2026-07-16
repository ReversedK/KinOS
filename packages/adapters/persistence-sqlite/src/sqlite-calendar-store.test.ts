import { createCalendarEvent } from "@kinos/core";
import { describe, expect, it } from "vitest";

import { SqliteCalendarStore } from "./sqlite-calendar-store.js";

function store() {
  return new SqliteCalendarStore(":memory:");
}
const ev = (over: Partial<Parameters<typeof createCalendarEvent>[0]> = {}) =>
  createCalendarEvent({ id: "evt_1", sphereId: "sph_1", title: "Dentist", start: "2026-07-20T09:00:00Z", createdAt: "2026-07-16T10:00:00Z", ...over });

describe("SqliteCalendarStore (RFC-012)", () => {
  it("persists and returns a Sphere's events ordered by start", async () => {
    const s = store();
    await s.create(ev({ id: "evt_2", start: "2026-07-21T09:00:00Z", title: "Later" }));
    await s.create(ev({ id: "evt_1", start: "2026-07-20T09:00:00Z", title: "Earlier" }));
    expect((await s.listBySphere("sph_1")).map((e) => e.title)).toEqual(["Earlier", "Later"]);
  });

  it("scopes by Sphere — a different Sphere sees nothing", async () => {
    const s = store();
    await s.create(ev({ sphereId: "sph_A" }));
    expect(await s.listBySphere("sph_B")).toEqual([]);
    expect((await s.listBySphere("sph_A"))[0]).toMatchObject({ title: "Dentist", sphereId: "sph_A" });
  });
});
