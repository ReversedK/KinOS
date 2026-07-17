import { describe, expect, it } from "vitest";

import { InMemoryAuditSink } from "./events.js";

describe("InMemoryAuditSink", () => {
  it("assigns ids and preserves recorded facts in order", () => {
    const sink = new InMemoryAuditSink();
    sink.record({
      type: "capability.requested",
      sphereId: "sph_1",
      resourceType: "capability",
      resourceId: "payment.execute",
      correlationId: "cor_1",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    sink.record({
      type: "capability.denied",
      sphereId: "sph_1",
      decision: "deny",
      reason: "denied by default",
      correlationId: "cor_1",
      createdAt: "2026-06-25T10:00:00.000Z",
    });

    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]?.id).toBe("evt_1");
    expect(sink.events[1]?.id).toBe("evt_2");
    expect(sink.events.map((e) => e.type)).toEqual([
      "capability.requested",
      "capability.denied",
    ]);
    expect(sink.events.every((e) => e.correlationId === "cor_1")).toBe(true);
  });

  it("byCorrelation returns only the matching chain", () => {
    const sink = new InMemoryAuditSink();
    sink.record({ type: "sphere.created", sphereId: "sph_1", correlationId: "a", createdAt: "t" });
    sink.record({ type: "agent.created", sphereId: "sph_1", correlationId: "b", createdAt: "t" });
    expect(sink.byCorrelation("a").map((e) => e.type)).toEqual(["sphere.created"]);
  });

  // RFC-020: the Sphere activity tail — scoped, newest first, and bounded so a
  // read can never drain the log.
  describe("recentBySphere", () => {
    const seeded = (): InMemoryAuditSink => {
      const sink = new InMemoryAuditSink();
      sink.record({ type: "sphere.created", sphereId: "sph_1", correlationId: "a", createdAt: "t1" });
      sink.record({ type: "agent.created", sphereId: "sph_2", correlationId: "b", createdAt: "t2" });
      sink.record({ type: "capability.requested", sphereId: "sph_1", correlationId: "c", createdAt: "t3" });
      sink.record({ type: "capability.executed", sphereId: "sph_1", correlationId: "c", createdAt: "t4" });
      return sink;
    };

    it("returns only the Sphere's own events, newest first", () => {
      expect(seeded().recentBySphere("sph_1", 10).map((e) => e.type)).toEqual([
        "capability.executed",
        "capability.requested",
        "sphere.created",
      ]);
    });

    it("bounds the result to the limit (newest kept)", () => {
      expect(seeded().recentBySphere("sph_1", 2).map((e) => e.type)).toEqual(["capability.executed", "capability.requested"]);
    });

    it("returns nothing for a non-positive limit or an unknown Sphere", () => {
      expect(seeded().recentBySphere("sph_1", 0)).toEqual([]);
      expect(seeded().recentBySphere("sph_nope", 10)).toEqual([]);
    });

    it("does not mutate the recorded order (reverse must not be in place)", () => {
      const sink = seeded();
      sink.recentBySphere("sph_1", 10);
      expect(sink.events.map((e) => e.type)).toEqual([
        "sphere.created",
        "agent.created",
        "capability.requested",
        "capability.executed",
      ]);
    });
  });
});
