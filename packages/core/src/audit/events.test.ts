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
});
