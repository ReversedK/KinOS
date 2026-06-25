import { describe, expect, it } from "vitest";
import { InMemorySphereStore } from "@kinos/core";

import { initSphere, listSpheres, showSphere, exportSphereJson } from "./commands.js";

const NOW = "2026-06-25T10:00:00.000Z";

describe("CLI commands over a SphereStore (results-contract §1/§15)", () => {
  it("init persists a Sphere that list and show then read back", async () => {
    const store = new InMemorySphereStore();

    await initSphere(store, { id: "sph_1", name: "Doe Family", founderName: "Parent One", now: NOW });

    expect(await listSpheres(store)).toContain("sph_1");

    const shown = await showSphere(store, "sph_1");
    expect(shown).toContain("Doe Family");
    expect(shown).toContain("members: 1");
  });

  it("show reports a missing Sphere", async () => {
    const store = new InMemorySphereStore();
    expect(await showSphere(store, "nope")).toMatch(/not found/i);
  });

  it("init refuses to overwrite an existing Sphere (deny by default)", async () => {
    const store = new InMemorySphereStore();
    await initSphere(store, { id: "sph_1", name: "First", founderName: "P", now: NOW });
    await expect(
      initSphere(store, { id: "sph_1", name: "Second", founderName: "P", now: NOW }),
    ).rejects.toThrow(/exists/i);
  });

  it("export emits a valid round-trippable snapshot JSON", async () => {
    const store = new InMemorySphereStore();
    await initSphere(store, { id: "sph_1", name: "Doe Family", founderName: "P", now: NOW });
    const json = await exportSphereJson(store, "sph_1");
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe("kinos.sphere.export");
    expect(parsed.sphere.id).toBe("sph_1");
  });
});
