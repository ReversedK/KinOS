import { describe, expect, it } from "vitest";

import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportSphere,
  importSphere,
} from "./export.js";
import { createSphere, addMember } from "../sphere/sphere.js";
import { createIdentity } from "../identity/identity.js";
import { createAgent } from "../agent/agent.js";
import { createMemoryItem, shareWithMembers } from "../memory/memory.js";
import type { Policy } from "../policy/types.js";

const NOW = "2026-06-25T10:00:00.000Z";

function fixture() {
  let sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  sphere = addMember(sphere, { memberId: "mbr_p2", identityId: "idy_p2", role: "parent" });
  sphere = addMember(sphere, { memberId: "mbr_c1", identityId: "idy_c1", role: "child" });

  const identities = [
    createIdentity({ id: "idy_p1", displayName: "Parent One" }),
    createIdentity({ id: "idy_c1", displayName: "Child One" }),
  ];
  const agents = [
    createAgent({ id: "agt_p1", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "P1 agent" }),
  ];
  const memory = [
    shareWithMembers(
      createMemoryItem({
        id: "mem_1",
        ownerId: "mbr_p1",
        ownerType: "member",
        sphereId: "sph_1",
        content: "grocery list",
        source: "manual",
        now: NOW,
      }),
      { subjectIds: ["mbr_c1"], grantedBy: "mbr_p1", now: NOW },
    ),
  ];
  const policies: Policy[] = [
    {
      id: "pol_1",
      sphereId: "sph_1",
      description: "Adults may create calendar events.",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["calendar.create_event"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
  ];
  return { sphere, identities, agents, memory, policies };
}

describe("Sphere export/import (results-contract §17, ADR-002)", () => {
  it("produces a documented, versioned snapshot", () => {
    const { sphere, identities, agents, memory, policies } = fixture();
    const snap = exportSphere({ sphere, identities, agents, memory, policies, exportedAt: NOW });
    expect(snap.format).toBe(EXPORT_FORMAT);
    expect(snap.version).toBe(EXPORT_VERSION);
    expect(snap.exportedAt).toBe(NOW);
    expect(snap.sphere.id).toBe("sph_1");
    expect(snap.memory[0]?.shareGrants?.[0]?.subjectId).toBe("mbr_c1");
  });

  it("round-trips through JSON without loss", () => {
    const f = fixture();
    const snap = exportSphere({ ...f, exportedAt: NOW });

    const restored = importSphere(JSON.parse(JSON.stringify(snap)));

    expect(restored.sphere).toEqual(f.sphere);
    expect(restored.identities).toEqual(f.identities);
    expect(restored.agents).toEqual(f.agents);
    expect(restored.memory).toEqual(f.memory);
    expect(restored.policies).toEqual(f.policies);
    expect(restored.exportedAt).toBe(NOW);
  });

  it("rejects an unknown format (fail closed)", () => {
    expect(() => importSphere({ format: "nope", version: 1 })).toThrow(/format/i);
  });

  it("rejects an unsupported version (fail closed)", () => {
    expect(() => importSphere({ format: EXPORT_FORMAT, version: 999 })).toThrow(/version/i);
  });

  it("rejects a non-object payload", () => {
    expect(() => importSphere(null)).toThrow();
    expect(() => importSphere("x")).toThrow();
  });
});
