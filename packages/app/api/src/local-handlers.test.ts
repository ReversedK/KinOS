import { InMemoryCalendarStore, defaultStoreCatalog, type CapabilityBinding, type ExecutionContext } from "@kinos/core";
import { describe, expect, it } from "vitest";

import { buildLocalHandlers } from "./local-handlers.js";

const binding: CapabilityBinding = {
  capability: "x",
  runtime: "local",
  runtimeToolName: "local.echo",
  execution: "local",
  risk: "low",
  requiresApproval: false,
  status: "enabled",
};

const ctx = (sphereId: string, memberId = "mbr_1"): ExecutionContext => ({
  sphereId,
  subject: { memberId, role: "parent", ageProfile: "adult" },
  correlationId: "cor_1",
  execution: "local",
  time: "2026-07-16T10:00:00.000Z",
});

function handlers(calendar = new InMemoryCalendarStore()) {
  let n = 0;
  return buildLocalHandlers({ calendar, newEventId: () => `evt_${++n}`, now: () => "2026-07-16T10:00:00.000Z" });
}

describe("local capability handlers", () => {
  // The load-bearing guard: a store package that "enables" but whose binding
  // resolves to no handler fails at the first tools/call with "no local handler".
  it("registers a handler for every local binding in the store catalog", () => {
    const h = handlers();
    for (const pkg of defaultStoreCatalog()) {
      for (const b of pkg.bindings) {
        if (b.runtime !== "local") continue;
        expect(h.has(b.runtimeToolName), `${pkg.id}: no handler for '${b.runtimeToolName}'`).toBe(true);
      }
    }
  });
});

describe("real calendar integration (RFC-012)", () => {
  it("create then read round-trips a real event, scoped from the governed context", async () => {
    const calendar = new InMemoryCalendarStore();
    const h = handlers(calendar);
    const create = h.get("local.calendar")!;
    const read = h.get("local.calendar_read")!;

    const created = (await create({ title: "Dentist", start: "2026-07-20T09:00:00Z" }, binding, ctx("sph_1"))) as {
      created: boolean;
      event: { id: string; sphereId: string; title: string; createdBy?: string };
    };
    expect(created.created).toBe(true);
    expect(created.event).toMatchObject({ sphereId: "sph_1", title: "Dentist", createdBy: "mbr_1" });

    const back = (await read({}, binding, ctx("sph_1"))) as { events: { title: string }[] };
    expect(back.events.map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("isolates Spheres: one Sphere never sees another's events", async () => {
    const calendar = new InMemoryCalendarStore();
    const h = handlers(calendar);
    await h.get("local.calendar")!({ title: "A-only", start: "2026-07-20T09:00:00Z" }, binding, ctx("sph_A"));

    const readB = (await h.get("local.calendar_read")!({}, binding, ctx("sph_B"))) as { events: unknown[] };
    expect(readB.events).toEqual([]);
    const readA = (await h.get("local.calendar_read")!({}, binding, ctx("sph_A"))) as { events: unknown[] };
    expect(readA.events).toHaveLength(1);
  });

  it("takes scope from the context, not from agent-supplied input (isolation cannot be forged)", async () => {
    const calendar = new InMemoryCalendarStore();
    const h = handlers(calendar);
    // Agent tries to plant an event into another Sphere via input — ignored.
    const created = (await h.get("local.calendar")!(
      { title: "Sneaky", start: "2026-07-20T09:00:00Z", sphereId: "sph_victim" },
      binding,
      ctx("sph_attacker"),
    )) as { event: { sphereId: string } };
    expect(created.event.sphereId).toBe("sph_attacker");
    const victim = (await h.get("local.calendar_read")!({}, binding, ctx("sph_victim"))) as { events: unknown[] };
    expect(victim.events).toEqual([]);
  });

  it("refuses to run without an execution context (fail closed)", async () => {
    const h = handlers();
    await expect(h.get("local.calendar_read")!({}, binding)).rejects.toThrow(/execution context/i);
  });

  it("rejects a blank title (deny-by-default on junk)", async () => {
    const h = handlers();
    await expect(h.get("local.calendar")!({ title: "  " }, binding, ctx("sph_1"))).rejects.toThrow(/title/i);
  });
});
