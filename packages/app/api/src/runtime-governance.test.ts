import { describe, expect, it } from "vitest";

import {
  InMemorySnapshotStore,
  InMemorySphereStore,
  createAgent,
  createSphere,
  exportSphere,
  type AgentTokenStore,
  type CapabilityBinding,
  type Policy,
  type ProvisionedToken,
  type ResolvedToken,
  type RuntimeStateBlobStore,
} from "@kinos/core";
import type { HermesFsPort } from "@kinos/runtime-hermes";

import { backupAgentState, projectAgentConfig, restoreAgentState, type RuntimeGovernanceDeps } from "./runtime-governance.js";

const NOW = "2026-06-27T10:00:00.000Z";

const searchBinding: CapabilityBinding = {
  capability: "memory.search",
  runtime: "hermes",
  runtimeToolName: "mem.search",
  execution: "local",
  risk: "low",
  requiresApproval: false,
  status: "enabled",
};
const allowSearchForParents: Policy = {
  id: "pol_search",
  sphereId: "sph_1",
  description: "Parents may search memory.",
  subjectSelector: { roles: ["parent"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["memory.search"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

class FakeTokens implements AgentTokenStore {
  rotations = 0;
  async provision(sphereId: string, agentId: string): Promise<ProvisionedToken> {
    this.rotations += 1;
    return {
      token: `tok-${this.rotations}`,
      record: { secretRef: `secret://sphere-mcp/${sphereId}/${agentId}`, sphereId, agentId, status: "active" },
    };
  }
  async rotate(s: string, a: string): Promise<ProvisionedToken> {
    return this.provision(s, a);
  }
  async revoke(): Promise<void> {}
  resolve(): ResolvedToken | undefined {
    return undefined;
  }
}

async function seed(): Promise<{ deps: RuntimeGovernanceDeps; written: Record<string, string>; tokens: FakeTokens }> {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A", enabledCapabilities: ["memory.search"] });
  await store.save(
    exportSphere({
      sphere,
      identities: [],
      agents: [agent],
      memory: [],
      policies: [allowSearchForParents],
      bindings: [searchBinding],
      exportedAt: NOW,
    }),
  );
  const written: Record<string, string> = {};
  const fs: HermesFsPort = {
    async mkdir() {},
    async readFile(p) {
      return written[p];
    },
    async writeFile(p, c) {
      written[p] = c;
    },
  };
  const tokens = new FakeTokens();
  const deps: RuntimeGovernanceDeps = {
    store,
    tokens,
    home: "/opt/data",
    fs,
    gatewayEndpoint: (s, a) => `http://api:8787/spheres/${s}/mcp#${a}`,
    now: () => NOW,
  };
  return { deps, written, tokens };
}

describe("projectAgentConfig (RFC-007/ADR-007 — runtime.config.project side effect)", () => {
  it("writes the agent profile with the policy-authorized tool surface and provisions a token", async () => {
    const { deps, written, tokens } = await seed();
    const res = await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });

    expect(res.allowedTools).toEqual(["memory.search"]); // the agent's own policy scope
    expect(res.configPath).toBe("/opt/data/profiles/agt_0/config.yaml");
    expect(tokens.rotations).toBe(1);

    const cfg = written["/opt/data/profiles/agt_0/config.yaml"];
    expect(cfg).toContain("sphere:");
    expect(cfg).toContain("memory.search");
    // The token value lands only in .env, never in config.yaml.
    expect(written["/opt/data/profiles/agt_0/.env"]).toBe("SPHERE_MCP_TOKEN=tok-1\n");
    expect(cfg).not.toContain("tok-1");
  });

  it("projects the agent's governed model into its Hermes profile (RFC-009)", async () => {
    // Same seed, but the agent carries a governed model preference. Hermes must
    // run on exactly that model, not the Sphere default (llama3.2).
    const store = new InMemorySphereStore();
    const sphere = createSphere({
      id: "sph_1",
      type: "family",
      name: "Doe",
      founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
    });
    const agent = createAgent({
      id: "agt_0",
      ownerId: "mbr_p1",
      ownerType: "member",
      sphereId: "sph_1",
      name: "A",
      modelPreference: "qwen2.5:7b",
      enabledCapabilities: ["memory.search"],
    });
    await store.save(
      exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies: [allowSearchForParents], bindings: [searchBinding], exportedAt: NOW }),
    );
    const written: Record<string, string> = {};
    const fs: HermesFsPort = {
      async mkdir() {},
      async readFile(p) {
        return written[p];
      },
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    const deps: RuntimeGovernanceDeps = {
      store,
      tokens: new FakeTokens(),
      home: "/opt/data",
      fs,
      gatewayEndpoint: (s, a) => `http://api:8787/spheres/${s}/mcp#${a}`,
      now: () => NOW,
    };

    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });
    const cfg = written["/opt/data/profiles/agt_0/config.yaml"];
    expect(cfg).toContain("qwen2.5:7b"); // the agent's governed model
    expect(cfg).not.toContain("llama3.2"); // not the Sphere default
  });

  it("re-projection rotates the token (writes a fresh .env)", async () => {
    const { deps, written } = await seed();
    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });
    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });
    expect(written["/opt/data/profiles/agt_0/.env"]).toBe("SPHERE_MCP_TOKEN=tok-2\n");
  });

  it("preserves existing Hermes channel config while reconciling governed sections", async () => {
    const { deps, written } = await seed();
    written["/opt/data/profiles/agt_0/config.yaml"] = [
      "platforms:",
      "  telegram:",
      "    enabled: true",
      "telegram:",
      "  allowed_chats: \"-10042\"",
      "mcp_servers:",
      "  stray:",
      "    url: http://bad.example/mcp",
      "    enabled: true",
      "",
    ].join("\n");
    written["/opt/data/profiles/agt_0/.env"] = "TELEGRAM_BOT_TOKEN=tg-1\n";

    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });

    expect(written["/opt/data/profiles/agt_0/config.yaml"]).toContain("platforms:");
    expect(written["/opt/data/profiles/agt_0/config.yaml"]).toContain("allowed_chats: \"-10042\"");
    expect(written["/opt/data/profiles/agt_0/config.yaml"]).toContain("sphere:");
    expect(written["/opt/data/profiles/agt_0/config.yaml"]).not.toContain("stray:");
    expect(written["/opt/data/profiles/agt_0/.env"]).toContain("TELEGRAM_BOT_TOKEN=tg-1\n");
    expect(written["/opt/data/profiles/agt_0/.env"]).toContain("SPHERE_MCP_TOKEN=tok-1\n");
  });

  it("fails closed for unknown sphere/agent or missing input", async () => {
    const { deps } = await seed();
    await expect(projectAgentConfig(deps, { sphereId: "sph_1" })).rejects.toThrow(/agentId/i);
    await expect(projectAgentConfig(deps, { sphereId: "nope", agentId: "agt_0" })).rejects.toThrow(/not found/i);
    await expect(projectAgentConfig(deps, { sphereId: "sph_1", agentId: "ghost" })).rejects.toThrow(/not found/i);
  });
});

/** A fake blob store recording captured dirs and supporting restore by ref. */
class FakeBlobs implements RuntimeStateBlobStore {
  readonly captured: Array<{ id: string; dir: string }> = [];
  readonly restored: Array<{ ref: string; dir: string }> = [];
  async capture(id: string, sourceDir: string): Promise<string> {
    this.captured.push({ id, dir: sourceDir });
    return `blob://${id}`;
  }
  async restore(ref: string, destDir: string): Promise<void> {
    this.restored.push({ ref, dir: destDir });
  }
}

async function seedSnapshots(): Promise<{ deps: RuntimeGovernanceDeps; blobs: FakeBlobs }> {
  const base = await seed();
  const blobs = new FakeBlobs();
  let n = 0;
  const deps: RuntimeGovernanceDeps = {
    ...base.deps,
    snapshots: new InMemorySnapshotStore(),
    blobs,
    newSnapshotId: () => `snap_${++n}`,
  };
  return { deps, blobs };
}

describe("backup/restoreAgentState (RFC-007/ADR-007 — runtime.session.* side effects)", () => {
  it("backup captures the agent profile dir and records a restorable snapshot", async () => {
    const { deps, blobs } = await seedSnapshots();
    const res = await backupAgentState(deps, { sphereId: "sph_1", agentId: "agt_0" });
    expect(res.snapshotId).toBe("snap_1");
    expect(res.ref).toBe("blob://snap_1");
    expect(blobs.captured).toEqual([{ id: "snap_1", dir: "/opt/data/profiles/agt_0" }]);
    expect(await deps.snapshots!.load("snap_1")).toMatchObject({ agentId: "agt_0", sphereId: "sph_1", state: "available" });
  });

  it("restore replays a snapshot belonging to the same agent into its profile dir", async () => {
    const { deps, blobs } = await seedSnapshots();
    const { snapshotId } = await backupAgentState(deps, { sphereId: "sph_1", agentId: "agt_0" });
    const res = await restoreAgentState(deps, { sphereId: "sph_1", agentId: "agt_0", snapshotId });
    expect(res).toEqual({ restored: true, snapshotId });
    expect(blobs.restored).toEqual([{ ref: "blob://snap_1", dir: "/opt/data/profiles/agt_0" }]);
  });

  it("restore is deny-by-default: refuses an unknown snapshot or another agent's snapshot", async () => {
    const { deps } = await seedSnapshots();
    const { snapshotId } = await backupAgentState(deps, { sphereId: "sph_1", agentId: "agt_0" });
    await expect(restoreAgentState(deps, { sphereId: "sph_1", agentId: "agt_0", snapshotId: "ghost" })).rejects.toThrow(/not found/i);
    // agt_9 doesn't exist in the sphere → loadAgent fails closed before the guard.
    await expect(restoreAgentState(deps, { sphereId: "sph_1", agentId: "agt_9", snapshotId })).rejects.toThrow(/not found/i);
  });
});
