import { describe, expect, it } from "vitest";

import {
  assertSnapshotRestorable,
  createRuntimeStateSnapshot,
  expireSnapshot,
} from "./snapshot.js";

const base = {
  id: "snap_1",
  agentId: "agt_0",
  sphereId: "sph_1",
  ref: "blob://encrypted/sph_1/agt_0/snap_1",
  createdAt: "2026-06-27T10:00:00.000Z",
};

describe("RuntimeStateSnapshot (RFC-007)", () => {
  it("holds an encrypted blob by reference and starts available", () => {
    const s = createRuntimeStateSnapshot(base);
    expect(s.ref).toBe(base.ref);
    expect(s.state).toBe("available");
    // The type has no content field — the blob is never inline (opaque).
    expect(Object.keys(s)).not.toContain("content");
  });

  it("rejects an empty blob reference (by reference only, deny by default)", () => {
    expect(() => createRuntimeStateSnapshot({ ...base, ref: "  " })).toThrow(/reference/i);
  });

  it("expiring a snapshot makes it non-restorable", () => {
    const expired = expireSnapshot(createRuntimeStateSnapshot(base));
    expect(expired.state).toBe("expired");
    expect(() => assertSnapshotRestorable(expired, { agentId: "agt_0", sphereId: "sph_1" })).toThrow(/expired/i);
  });

  it("refuses to restore another agent's or Sphere's snapshot (deny by default)", () => {
    const s = createRuntimeStateSnapshot(base);
    expect(() => assertSnapshotRestorable(s, { agentId: "agt_other", sphereId: "sph_1" })).toThrow(/agent/i);
    expect(() => assertSnapshotRestorable(s, { agentId: "agt_0", sphereId: "sph_other" })).toThrow(/sphere/i);
    // The matching agent/Sphere on an available snapshot is restorable.
    expect(() => assertSnapshotRestorable(s, { agentId: "agt_0", sphereId: "sph_1" })).not.toThrow();
  });
});
