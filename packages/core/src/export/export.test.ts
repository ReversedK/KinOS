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
import type { CapabilityBinding } from "../capability/types.js";
import { createRuntimeProfile, defaultRuntimeConfig, type SphereRuntimeConfig } from "../runtime/profile.js";
import { createIntegration } from "../integration/integration.js";
import { createManifest, installPackage } from "../package/package.js";
import { createSphereProject } from "../project/project.js";

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
  const bindings: CapabilityBinding[] = [
    {
      capability: "calendar.create_event",
      runtime: "local",
      runtimeToolName: "local.calendar",
      execution: "local",
      risk: "medium",
      requiresApproval: false,
      status: "enabled",
    },
  ];
  return { sphere, identities, agents, memory, policies, bindings };
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
    expect(restored.bindings).toEqual(f.bindings);
    expect(restored.exportedAt).toBe(NOW);
  });

  it("defaults bindings to an empty array when the snapshot omits them", () => {
    const f = fixture();
    const snap = exportSphere({
      sphere: f.sphere,
      identities: f.identities,
      agents: f.agents,
      memory: f.memory,
      policies: f.policies,
      exportedAt: NOW,
    });
    // Simulate an older snapshot with no bindings section.
    const legacy = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;
    delete legacy["bindings"];
    expect(importSphere(legacy).bindings).toEqual([]);
  });

  it("RFC-029: round-trips shared projects and defaults them empty for an older snapshot", () => {
    const f = fixture();
    const project = createSphereProject({
      id: "prj_1",
      sphereId: "sph_1",
      ownerId: "mbr_p1",
      ownerType: "member",
      title: "Summer trip",
      description: "plan the August holiday",
      now: NOW,
    });
    const snap = exportSphere({ ...f, projects: [project], exportedAt: NOW });
    const restored = importSphere(JSON.parse(JSON.stringify(snap)));
    expect(restored.projects).toEqual([project]);

    // An older snapshot with no projects section restores as empty (no version bump).
    const legacy = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;
    delete legacy["projects"];
    expect(importSphere(legacy).projects).toEqual([]);
  });

  it("round-trips a custom runtime config (RFC-004)", () => {
    const f = fixture();
    const runtimeConfig: SphereRuntimeConfig = {
      defaultProfile: createRuntimeProfile({
        providerId: "openai",
        model: "gpt-4o-mini",
        execution: "cloud",
        secretRef: "secret://openai/key",
      }),
      allowedProviders: ["ollama", "openai"],
      cloudInferenceEnabled: true,
    };
    const snap = exportSphere({ ...f, runtimeConfig, exportedAt: NOW });
    const restored = importSphere(JSON.parse(JSON.stringify(snap)));
    expect(restored.runtimeConfig).toEqual(runtimeConfig);
    // the secret reference round-trips; no raw key is involved
    expect(restored.runtimeConfig.defaultProfile.secretRef).toBe("secret://openai/key");
  });

  it("defaults runtimeConfig to local-first when the snapshot omits it", () => {
    const f = fixture();
    const snap = exportSphere({ ...f, exportedAt: NOW });
    const legacy = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>;
    delete legacy["runtimeConfig"];
    expect(importSphere(legacy).runtimeConfig).toEqual(defaultRuntimeConfig());
  });

  it("rejects a non-object runtimeConfig (fail closed)", () => {
    expect(() =>
      importSphere({ format: EXPORT_FORMAT, version: EXPORT_VERSION, sphere: {}, exportedAt: NOW, identities: [], agents: [], memory: [], policies: [], runtimeConfig: "nope" }),
    ).toThrow(/runtimeConfig/i);
  });

  it("round-trips integrations and defaults to empty when omitted", () => {
    const f = fixture();
    const integrations = [
      createIntegration({
        id: "int_1",
        sphereId: "sph_1",
        provider: "google",
        scopes: ["calendar.read"],
        secretRef: "secret://google/oauth",
        providesCapabilities: ["calendar.create_event"],
      }),
    ];
    const snap = exportSphere({ ...f, integrations, exportedAt: NOW });
    expect(importSphere(JSON.parse(JSON.stringify(snap))).integrations).toEqual(integrations);

    const legacy = JSON.parse(JSON.stringify(exportSphere({ ...f, exportedAt: NOW }))) as Record<string, unknown>;
    delete legacy["integrations"];
    expect(importSphere(legacy).integrations).toEqual([]);
  });

  it("rejects a non-array integrations section (fail closed)", () => {
    expect(() =>
      importSphere({ format: EXPORT_FORMAT, version: EXPORT_VERSION, sphere: {}, exportedAt: NOW, identities: [], agents: [], memory: [], policies: [], integrations: "nope" }),
    ).toThrow(/integrations/i);
  });

  it("round-trips installed packages and defaults to empty when omitted", () => {
    const f = fixture();
    const pkgs = [
      installPackage(
        createManifest({ id: "p1", type: "skill", title: "Skill", description: "Does a thing.", version: "1.0.0", publisher: "kinos", ageRating: "all" }),
        "sph_1",
      ),
    ];
    const snap = exportSphere({ ...f, packages: pkgs, exportedAt: NOW });
    expect(importSphere(JSON.parse(JSON.stringify(snap))).packages).toEqual(pkgs);

    const legacy = JSON.parse(JSON.stringify(exportSphere({ ...f, exportedAt: NOW }))) as Record<string, unknown>;
    delete legacy["packages"];
    expect(importSphere(legacy).packages).toEqual([]);
  });

  it("rejects a non-array packages section (fail closed)", () => {
    expect(() =>
      importSphere({ format: EXPORT_FORMAT, version: EXPORT_VERSION, sphere: {}, exportedAt: NOW, identities: [], agents: [], memory: [], policies: [], packages: "nope" }),
    ).toThrow(/packages/i);
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
