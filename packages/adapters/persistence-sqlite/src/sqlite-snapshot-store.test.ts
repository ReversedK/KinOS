import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntimeStateSnapshot } from "@kinos/core";

import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";

let dir: string | undefined;
let store: SqliteSnapshotStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
function open(): SqliteSnapshotStore {
  dir = mkdtempSync(join(tmpdir(), "kinos-snap-"));
  store = new SqliteSnapshotStore(join(dir, "snap.sqlite"));
  return store;
}

describe("SqliteSnapshotStore (RFC-007)", () => {
  it("saves and loads a snapshot record (by reference, no content)", async () => {
    const s = open();
    const snap = createRuntimeStateSnapshot({ id: "snap_1", agentId: "agt_0", sphereId: "sph_1", ref: "blob://snap_1", createdAt: "2026-06-27T10:00:00.000Z" });
    await s.save(snap);
    expect(await s.load("snap_1")).toEqual(snap);
    expect(await s.load("nope")).toBeUndefined();
  });

  it("lists an agent's snapshots newest-first, scoped to sphere+agent", async () => {
    const s = open();
    await s.save(createRuntimeStateSnapshot({ id: "a", agentId: "agt_0", sphereId: "sph_1", ref: "blob://a", createdAt: "2026-06-27T10:00:00.000Z" }));
    await s.save(createRuntimeStateSnapshot({ id: "b", agentId: "agt_0", sphereId: "sph_1", ref: "blob://b", createdAt: "2026-06-27T11:00:00.000Z" }));
    await s.save(createRuntimeStateSnapshot({ id: "c", agentId: "agt_9", sphereId: "sph_1", ref: "blob://c", createdAt: "2026-06-27T12:00:00.000Z" }));
    const list = await s.listForAgent("sph_1", "agt_0");
    expect(list.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
