import { describe, expect, it } from "vitest";

import { addMember, createSphere, listMembers } from "./sphere.js";
import { effectiveAgeProfile, isMinor, normalizeRole } from "./member.js";

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

  it("RFC-042: role and age profile are independent — a generic 'member' can be a teen minor", () => {
    let sphere = createSphere({ id: "sph_1", type: "team", name: "Acme", founder: { memberId: "mbr_a", identityId: "idy_a", role: "admin" } });
    // A generic governance role with an EXPLICIT age profile.
    sphere = addMember(sphere, { memberId: "mbr_t", identityId: "idy_t", role: "member", ageProfile: "teen" });
    const admin = sphere.members.find((m) => m.id === "mbr_a")!;
    const teen = sphere.members.find((m) => m.id === "mbr_t")!;
    // admin: generic role, adult; teen: generic role, minor — age is NOT derived from role.
    expect(admin.role).toBe("admin");
    expect(effectiveAgeProfile(admin)).toBe("adult");
    expect(teen.role).toBe("member");
    expect(effectiveAgeProfile(teen)).toBe("teen");
    expect(isMinor(effectiveAgeProfile(teen))).toBe(true);
    expect(isMinor(effectiveAgeProfile(admin))).toBe(false);
  });

  it("RFC-042: a legacy role normalizes to a governance role + age profile (backward compat)", () => {
    expect(normalizeRole("parent")).toEqual({ role: "admin", ageProfile: "adult" });
    expect(normalizeRole("child")).toEqual({ role: "member", ageProfile: "child" });
    expect(normalizeRole("teenager")).toEqual({ role: "member", ageProfile: "teen" });
    // A member created with a legacy role gets an explicit age profile, role kept for compat.
    let s = createSphere({ id: "sph_2", type: "family", name: "Doe", founder: { memberId: "mbr_p", identityId: "idy_p", role: "parent" } });
    s = addMember(s, { memberId: "mbr_c", identityId: "idy_c", role: "child" });
    expect(effectiveAgeProfile(s.members.find((m) => m.id === "mbr_c")!)).toBe("child");
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
