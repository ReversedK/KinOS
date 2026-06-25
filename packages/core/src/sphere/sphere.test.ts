import { describe, expect, it } from "vitest";

import { addMember, createSphere, listMembers } from "./sphere.js";
import { isMinor } from "./member.js";

// Encodes results-contract §19: "a Sphere can be created" and
// "two adults and one child can be added".
describe("Sphere creation and membership (results-contract §19)", () => {
  const founder = { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" } as const;

  it("creates a family Sphere, active, with the founder as administrator", () => {
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe Family",
      founder,
    });

    expect(sphere.id).toBe("sph_1");
    expect(sphere.type).toBe("family");
    expect(sphere.status).toBe("active");
    expect(sphere.administrators).toContain("mbr_p1");
    expect(listMembers(sphere)).toHaveLength(1);
  });

  it("rejects an empty Sphere name (deny by default)", () => {
    expect(() =>
      createSphere({ id: "sph_1", type: "family", name: "   ", founder }),
    ).toThrow(/name/i);
  });

  it("adds a second adult and one child", () => {
    let sphere = createSphere({ id: "sph_1", type: "family", name: "Doe Family", founder });
    sphere = addMember(sphere, { memberId: "mbr_p2", identityId: "idy_p2", role: "parent" });
    sphere = addMember(sphere, { memberId: "mbr_c1", identityId: "idy_c1", role: "child" });

    const members = listMembers(sphere);
    expect(members).toHaveLength(3);

    const adults = members.filter((m) => !isMinor(m.role));
    const minors = members.filter((m) => isMinor(m.role));
    expect(adults).toHaveLength(2);
    expect(minors).toHaveLength(1);
    expect(minors[0]?.role).toBe("child");
    expect(members.every((m) => m.status === "active")).toBe(true);
  });

  it("rejects a duplicate member id (deny by default)", () => {
    const sphere = createSphere({ id: "sph_1", type: "family", name: "Doe Family", founder });
    expect(() =>
      addMember(sphere, { memberId: "mbr_p1", identityId: "idy_x", role: "child" }),
    ).toThrow(/already/i);
  });

  it("does not mutate the input Sphere when adding a member", () => {
    const sphere = createSphere({ id: "sph_1", type: "family", name: "Doe Family", founder });
    addMember(sphere, { memberId: "mbr_p2", identityId: "idy_p2", role: "parent" });
    expect(listMembers(sphere)).toHaveLength(1);
  });
});
