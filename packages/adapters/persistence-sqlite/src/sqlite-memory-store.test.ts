import { createMemoryItem, shareWithMembers, type MemoryItem } from "@kinos/core";
import { describe, expect, it } from "vitest";

import { SqliteMemoryStore } from "./sqlite-memory-store.js";

const NOW = "2026-07-16T10:00:00.000Z";
function store() {
  return new SqliteMemoryStore(":memory:");
}
const item = (over: Partial<Parameters<typeof createMemoryItem>[0]> = {}): MemoryItem =>
  createMemoryItem({ id: "mem_1", ownerId: "mbr_A", ownerType: "member", sphereId: "sph_1", content: "note", source: "manual", now: NOW, ...over });

describe("SqliteMemoryStore (ADR-009/RFC-044)", () => {
  it("appends and returns a Sphere's items; get resolves by id", async () => {
    const s = store();
    await s.append(item({ id: "mem_2", content: "second" }));
    await s.append(item({ id: "mem_1", content: "first" }));
    expect((await s.listBySphere("sph_1")).map((m) => m.content)).toEqual(["first", "second"]);
    expect((await s.get("sph_1", "mem_2"))?.content).toBe("second");
    expect(await s.get("sph_1", "nope")).toBeUndefined();
  });

  it("scopes by Sphere — a different Sphere sees nothing", async () => {
    const s = store();
    await s.append(item({ sphereId: "sph_A" }));
    expect(await s.listBySphere("sph_B")).toEqual([]);
    expect(await s.get("sph_B", "mem_1")).toBeUndefined();
    expect((await s.listBySphere("sph_A"))[0]).toMatchObject({ content: "note", sphereId: "sph_A" });
  });

  it("replace updates an item in place (share/revoke/lifecycle)", async () => {
    const s = store();
    await s.append(item({ id: "mem_1" }));
    const shared = shareWithMembers((await s.get("sph_1", "mem_1"))!, { subjectIds: ["mbr_B"], grantedBy: "mbr_A", now: NOW });
    await s.replace(shared);
    const back = (await s.get("sph_1", "mem_1"))!;
    expect(back.visibility).toBe("shared_with_members");
    expect(back.shareGrants?.[0]).toMatchObject({ subjectId: "mbr_B" });
    expect(await s.listBySphere("sph_1")).toHaveLength(1); // replaced, not duplicated
  });

  it("deleteBySphere removes only that Sphere's items", async () => {
    const s = store();
    await s.append(item({ id: "mem_1", sphereId: "sph_1" }));
    await s.append(item({ id: "mem_2", sphereId: "sph_2" }));
    await s.deleteBySphere("sph_1");
    expect(await s.listBySphere("sph_1")).toEqual([]);
    expect(await s.listBySphere("sph_2")).toHaveLength(1);
  });
});
