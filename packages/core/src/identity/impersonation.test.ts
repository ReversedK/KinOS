import { describe, expect, it } from "vitest";

import { ageProfileForRole, resolveImpersonatedSubject } from "./impersonation.js";
import type { Member } from "../sphere/member.js";

const members: readonly Member[] = [
  { id: "mbr_p1", identityId: "idy_p1", role: "parent", status: "active" },
  { id: "mbr_c1", identityId: "idy_c1", role: "child", status: "active" },
  { id: "mbr_t1", identityId: "idy_t1", role: "teenager", status: "active" },
  { id: "mbr_x1", identityId: "idy_x1", role: "parent", status: "suspended" },
];

const dev = (actAsMemberId: string, enabled = true) => ({
  actAsMemberId,
  byDeveloper: "dev-1",
  devImpersonationEnabled: enabled,
});

describe("ageProfileForRole", () => {
  it("maps roles to age profiles (minors stay restricted)", () => {
    expect(ageProfileForRole("parent")).toBe("adult");
    expect(ageProfileForRole("guest")).toBe("adult");
    expect(ageProfileForRole("teenager")).toBe("teen");
    expect(ageProfileForRole("child")).toBe("child");
  });
});

describe("resolveImpersonatedSubject (RFC-006)", () => {
  it("resolves a member's real role and age profile, recording who impersonates", () => {
    const r = resolveImpersonatedSubject(members, dev("mbr_p1"));
    expect(r.subject).toEqual({ memberId: "mbr_p1", role: "parent", ageProfile: "adult" });
    expect(r.impersonated).toBe(true);
    expect(r.impersonatedBy).toBe("dev-1");
  });

  it("does not elevate a minor — a child resolves to a child subject", () => {
    const r = resolveImpersonatedSubject(members, dev("mbr_c1"));
    expect(r.subject).toEqual({ memberId: "mbr_c1", role: "child", ageProfile: "child" });
  });

  it("is deny-by-default when the dev flag is off (impersonation does not exist)", () => {
    expect(() => resolveImpersonatedSubject(members, dev("mbr_p1", false))).toThrow(/disabled/i);
  });

  it("refuses an unknown member (fail closed)", () => {
    expect(() => resolveImpersonatedSubject(members, dev("mbr_nope"))).toThrow(/not found/i);
  });

  it("refuses a non-active member (fail closed)", () => {
    expect(() => resolveImpersonatedSubject(members, dev("mbr_x1"))).toThrow(/not active/i);
  });
});
