import { describe, expect, it } from "vitest";
import { InMemoryAuditSink, InMemorySphereStore } from "@kinos/core";

import { initSphere, listSpheres, showSphere, exportSphereJson, showAudit } from "./commands.js";

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

  it("init emits a sphere.created audit event under the given correlation id", async () => {
    const store = new InMemorySphereStore();
    const audit = new InMemoryAuditSink();
    await initSphere(store, {
      id: "sph_1",
      name: "Doe Family",
      founderName: "P",
      now: NOW,
      audit,
      correlationId: "cor_init",
    });
    const chain = audit.byCorrelation("cor_init");
    expect(chain.map((e) => e.type)).toEqual(["sphere.created"]);
    expect(chain[0]?.resourceId).toBe("sph_1");
  });

  it("showAudit renders a correlation chain and reports an empty one", () => {
    const audit = new InMemoryAuditSink();
    audit.record({
      type: "sphere.created",
      sphereId: "sph_1",
      resourceType: "sphere",
      resourceId: "sph_1",
      correlationId: "cor_init",
      createdAt: NOW,
    });
    expect(showAudit(audit, "cor_init")).toContain("sphere.created");
    expect(showAudit(audit, "missing")).toMatch(/no audit events/i);
  });
});
