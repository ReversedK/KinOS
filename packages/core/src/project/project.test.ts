import { describe, expect, it } from "vitest";

import { createSphereProject } from "./project.js";

const NOW = "2026-06-25T10:00:00.000Z";

describe("SphereProject (RFC-029)", () => {
  it("creates an active project, trimming title and description", () => {
    const p = createSphereProject({
      id: "prj_1",
      sphereId: "sph_1",
      ownerId: "mbr_p1",
      ownerType: "member",
      title: "  Summer trip  ",
      description: "  plan the holiday  ",
      now: NOW,
    });
    expect(p.title).toBe("Summer trip");
    expect(p.description).toBe("plan the holiday");
    expect(p.state).toBe("active");
    expect(p.createdAt).toBe(NOW);
    expect(p.updatedAt).toBe(NOW);
  });

  it("omits an empty description rather than storing a blank string", () => {
    const p = createSphereProject({ id: "prj_2", sphereId: "sph_1", ownerId: "sph_1", ownerType: "sphere", title: "Chores", description: "   ", now: NOW });
    expect(p.description).toBeUndefined();
  });

  it("refuses a blank title (nothing to name)", () => {
    expect(() => createSphereProject({ id: "prj_3", sphereId: "sph_1", ownerId: "mbr_p1", ownerType: "member", title: "   ", now: NOW })).toThrow(/title/i);
  });
});
