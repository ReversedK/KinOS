import { describe, expect, it } from "vitest";

import { authorizeMemoryRead, resolveReadableMemory } from "./resolver.js";
import { createMemoryItem, shareWithMembers, revokeShare } from "./memory.js";
import type { Policy } from "../policy/types.js";
import type { PolicyRequest } from "../policy/types.js";

const NOW = "2026-06-25T10:00:00+00:00";

const parent: PolicyRequest["subject"] = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
const child: PolicyRequest["subject"] = { memberId: "mbr_c1", role: "child", ageProfile: "child" };

function ctx() {
  return { sphereId: "sph_1", time: NOW, correlationId: "cor_m" };
}

function parentPrivateNote() {
  return createMemoryItem({
    id: "mem_1",
    ownerId: "mbr_p1",
    ownerType: "member",
    sphereId: "sph_1",
    content: "private note",
    source: "manual",
    now: NOW,
  });
}

describe("Memory Resolver — §19 child cannot read adult private memory", () => {
  it("lets the owner read their own private memory", () => {
    expect(authorizeMemoryRead(parent, parentPrivateNote(), [], ctx()).effect).toBe("allow");
  });

  it("denies a child reading a parent's private memory (deny by default)", () => {
    const d = authorizeMemoryRead(child, parentPrivateNote(), [], ctx());
    expect(d.effect).toBe("deny");
  });
});

describe("Memory Resolver — §19 memory can be shared and revoked", () => {
  it("grants the child read after a share and removes it after revoke", () => {
    const shared = shareWithMembers(parentPrivateNote(), {
      subjectIds: ["mbr_c1"],
      grantedBy: "mbr_p1",
      now: NOW,
    });
    expect(authorizeMemoryRead(child, shared, [], ctx()).effect).toBe("allow");

    const revoked = revokeShare(shared, { subjectId: "mbr_c1", now: NOW });
    expect(authorizeMemoryRead(child, revoked, [], ctx()).effect).toBe("deny");
    // owner still reads it after the share is revoked
    expect(authorizeMemoryRead(parent, revoked, [], ctx()).effect).toBe("allow");
  });
});

describe("Memory Resolver — sensitivity deny overrides structural visibility (ADR example 3)", () => {
  it("denies a supervisor reading a medical item even within supervisor scope", () => {
    const medical = {
      ...createMemoryItem({
        id: "mem_med",
        ownerId: "mbr_p2",
        ownerType: "member" as const,
        sphereId: "sph_1",
        content: "medical",
        source: "manual" as const,
        now: NOW,
      }),
      visibility: "shared_with_supervisors" as const,
      sensitivity: "medical" as const,
    };
    const medicalDeny: Policy = {
      id: "pol_medical_private",
      sphereId: "sph_1",
      description: "Medical memory is not exposed to supervisors (supervision != surveillance).",
      subjectSelector: {},
      action: "read",
      resourceSelector: { types: ["memory"], sensitivities: ["medical"] },
      effect: "deny",
      priority: 100,
      version: 1,
      status: "active",
    };
    expect(authorizeMemoryRead(parent, medical, [medicalDeny], ctx()).effect).toBe("deny");
  });
});

describe("Memory Resolver — resolveReadableMemory returns only authorized items", () => {
  it("filters a mixed set for a child", () => {
    const ownPrivate = createMemoryItem({
      id: "mem_child_own",
      ownerId: "mbr_c1",
      ownerType: "member",
      sphereId: "sph_1",
      content: "child's own",
      source: "manual",
      now: NOW,
    });
    const parentPrivate = parentPrivateNote();
    const sharedToChild = shareWithMembers(
      createMemoryItem({
        id: "mem_shared",
        ownerId: "mbr_p1",
        ownerType: "member",
        sphereId: "sph_1",
        content: "shared",
        source: "manual",
        now: NOW,
      }),
      { subjectIds: ["mbr_c1"], grantedBy: "mbr_p1", now: NOW },
    );

    const readable = resolveReadableMemory(
      child,
      [ownPrivate, parentPrivate, sharedToChild],
      [],
      ctx(),
    );
    const ids = readable.map((m) => m.id).sort();
    expect(ids).toEqual(["mem_child_own", "mem_shared"]);
  });
});
