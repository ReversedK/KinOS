import { describe, expect, it } from "vitest";

import { createMemoryItem, revokeShare, shareWithMembers } from "./memory.js";

const NOW = "2026-06-25T10:00:00+00:00";
const LATER = "2026-06-25T12:00:00+00:00";

function parentNote() {
  return createMemoryItem({
    id: "mem_1",
    ownerId: "mbr_p1",
    ownerType: "member",
    sphereId: "sph_1",
    content: "dentist at 9",
    source: "manual",
    now: NOW,
  });
}

describe("MemoryItem creation (ADR-002)", () => {
  it("is private and active by default, with normal sensitivity", () => {
    const item = parentNote();
    expect(item.visibility).toBe("private");
    expect(item.state).toBe("active");
    expect(item.sensitivity).toBe("normal");
    expect(item.ownerId).toBe("mbr_p1");
    expect(item.ownerType).toBe("member");
    expect(item.createdAt).toBe(NOW);
    expect(item.updatedAt).toBe(NOW);
    expect(item.shareGrants ?? []).toHaveLength(0);
  });
});

describe("Sharing keeps ownership; revocation keeps the grant as an audit fact", () => {
  it("shareWithMembers records a grant and widens visibility without changing owner", () => {
    const shared = shareWithMembers(parentNote(), {
      subjectIds: ["mbr_c1"],
      grantedBy: "mbr_p1",
      now: LATER,
    });
    expect(shared.visibility).toBe("shared_with_members");
    expect(shared.ownerId).toBe("mbr_p1");
    expect(shared.shareGrants).toHaveLength(1);
    expect(shared.shareGrants?.[0]).toMatchObject({
      subjectId: "mbr_c1",
      grantedBy: "mbr_p1",
      grantedAt: LATER,
    });
    expect(shared.shareGrants?.[0]?.revokedAt).toBeUndefined();
  });

  it("revokeShare sets revokedAt but retains the grant and keeps the item active", () => {
    const shared = shareWithMembers(parentNote(), {
      subjectIds: ["mbr_c1"],
      grantedBy: "mbr_p1",
      now: LATER,
    });
    const revoked = revokeShare(shared, { subjectId: "mbr_c1", now: "2026-06-25T13:00:00+00:00" });
    expect(revoked.shareGrants).toHaveLength(1); // grant retained as audit fact
    expect(revoked.shareGrants?.[0]?.revokedAt).toBe("2026-06-25T13:00:00+00:00");
    expect(revoked.state).toBe("active"); // revocation != deletion; owner keeps it
    expect(revoked.ownerId).toBe("mbr_p1");
  });

  it("does not mutate the input item", () => {
    const item = parentNote();
    shareWithMembers(item, { subjectIds: ["mbr_c1"], grantedBy: "mbr_p1", now: LATER });
    expect(item.visibility).toBe("private");
    expect(item.shareGrants ?? []).toHaveLength(0);
  });
});
