import { describe, expect, it } from "vitest";

import {
  InMemorySphereStore,
  createAgent,
  createSphere,
  exportSphere,
  type AgentTokenStore,
  type CapabilityBinding,
  type Policy,
  type ProvisionedToken,
  type ResolvedToken,
} from "@kinos/core";
import type { HermesFsPort } from "@kinos/runtime-hermes";

import { projectAgentConfig, type RuntimeGovernanceDeps } from "./runtime-governance.js";

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
  const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "A" });
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
    expect(res.configPath).toBe("/opt/data/agt_0/config.yaml");
    expect(tokens.rotations).toBe(1);

    const cfg = written["/opt/data/agt_0/config.yaml"];
    expect(cfg).toContain("sphere:");
    expect(cfg).toContain("memory.search");
    // The token value lands only in .env, never in config.yaml.
    expect(written["/opt/data/agt_0/.env"]).toBe("SPHERE_MCP_TOKEN=tok-1\n");
    expect(cfg).not.toContain("tok-1");
  });

  it("re-projection rotates the token (writes a fresh .env)", async () => {
    const { deps, written } = await seed();
    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });
    await projectAgentConfig(deps, { sphereId: "sph_1", agentId: "agt_0" });
    expect(written["/opt/data/agt_0/.env"]).toBe("SPHERE_MCP_TOKEN=tok-2\n");
  });

  it("fails closed for unknown sphere/agent or missing input", async () => {
    const { deps } = await seed();
    await expect(projectAgentConfig(deps, { sphereId: "sph_1" })).rejects.toThrow(/agentId/i);
    await expect(projectAgentConfig(deps, { sphereId: "nope", agentId: "agt_0" })).rejects.toThrow(/not found/i);
    await expect(projectAgentConfig(deps, { sphereId: "sph_1", agentId: "ghost" })).rejects.toThrow(/not found/i);
  });
});
