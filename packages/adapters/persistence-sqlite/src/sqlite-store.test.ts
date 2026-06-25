import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSphere, createSphere } from "@kinos/core";

import { SqliteSphereStore } from "./sqlite-store.js";

const NOW = "2026-06-25T10:00:00.000Z";

function snapshot(id: string, name = "Doe Family") {
  const sphere = createSphere({
    id,
    type: "family",
    name,
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  return exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW });
}

describe("SqliteSphereStore — SphereStore contract", () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteSphereStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kinos-sqlite-"));
    dbPath = join(dir, "kinos.sqlite");
    store = new SqliteSphereStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a snapshot by sphere id", async () => {
    await store.save(snapshot("sph_1"));
    expect((await store.load("sph_1"))?.sphere.name).toBe("Doe Family");
  });

  it("returns undefined for a missing sphere", async () => {
    expect(await store.load("nope")).toBeUndefined();
  });

  it("lists ids and overwrites on re-save", async () => {
    await store.save(snapshot("sph_1", "First"));
    await store.save(snapshot("sph_2"));
    await store.save(snapshot("sph_1", "Renamed"));
    expect([...(await store.list())].sort()).toEqual(["sph_1", "sph_2"]);
    expect((await store.load("sph_1"))?.sphere.name).toBe("Renamed");
  });

  it("deletes a sphere", async () => {
    await store.save(snapshot("sph_1"));
    await store.delete("sph_1");
    expect(await store.load("sph_1")).toBeUndefined();
  });

  it("persists across a reopen of the same database file (durability)", async () => {
    await store.save(snapshot("sph_dur", "Durable"));
    store.close();

    const reopened = new SqliteSphereStore(dbPath);
    try {
      expect((await reopened.load("sph_dur"))?.sphere.name).toBe("Durable");
    } finally {
      reopened.close();
    }
  });
});
