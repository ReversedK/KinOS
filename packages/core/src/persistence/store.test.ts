import { describe, expect, it } from "vitest";

import { InMemorySphereStore } from "./store.js";
import { exportSphere } from "../export/export.js";
import { createSphere } from "../sphere/sphere.js";

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

describe("SphereStore contract — InMemorySphereStore", () => {
  it("saves and loads a snapshot by sphere id", async () => {
    const store = new InMemorySphereStore();
    await store.save(snapshot("sph_1"));
    const loaded = await store.load("sph_1");
    expect(loaded?.sphere.id).toBe("sph_1");
    expect(loaded?.sphere.name).toBe("Doe Family");
  });

  it("returns undefined for a missing sphere", async () => {
    const store = new InMemorySphereStore();
    expect(await store.load("nope")).toBeUndefined();
  });

  it("lists saved sphere ids and overwrites on re-save", async () => {
    const store = new InMemorySphereStore();
    await store.save(snapshot("sph_1", "First"));
    await store.save(snapshot("sph_2"));
    await store.save(snapshot("sph_1", "Renamed"));
    expect([...(await store.list())].sort()).toEqual(["sph_1", "sph_2"]);
    expect((await store.load("sph_1"))?.sphere.name).toBe("Renamed");
  });

  it("deletes a sphere", async () => {
    const store = new InMemorySphereStore();
    await store.save(snapshot("sph_1"));
    await store.delete("sph_1");
    expect(await store.load("sph_1")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("isolates stored data from later mutation of the input or the result", async () => {
    const store = new InMemorySphereStore();
    const snap = snapshot("sph_1");
    await store.save(snap);

    // Mutating the original after save must not change stored state.
    (snap.sphere as { name: string }).name = "Mutated";
    const loaded = await store.load("sph_1");
    expect(loaded?.sphere.name).toBe("Doe Family");

    // Mutating a loaded copy must not change stored state either.
    (loaded!.sphere as { name: string }).name = "AlsoMutated";
    expect((await store.load("sph_1"))?.sphere.name).toBe("Doe Family");
  });
});
