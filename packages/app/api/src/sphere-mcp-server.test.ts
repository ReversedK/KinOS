import { describe, expect, it } from "vitest";

import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySphereStore,
  createAgent,
  createSphere,
  exportSphere,
  type AgentTokenStore,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
  type ProvisionedToken,
  type ResolvedToken,
} from "@kinos/core";

import { handleSphereMcpRpc, type SphereMcpServerDeps } from "./sphere-mcp-server.js";

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

/** A fake token directory: a fixed token -> agent, others unresolved. */
class FakeTokens implements AgentTokenStore {
  constructor(private readonly token: string, private readonly owner: ResolvedToken) {}
  async provision(): Promise<ProvisionedToken> {
    throw new Error("not used");
  }
  async rotate(): Promise<ProvisionedToken> {
    throw new Error("not used");
  }
  async revoke(): Promise<void> {}
  resolve(token: string): ResolvedToken | undefined {
    return token === this.token ? this.owner : undefined;
  }
}

const executor: CapabilityExecutor = {
  async execute(binding, input) {
    return { tool: binding.runtimeToolName, input };
  },
};

async function seed(): Promise<SphereMcpServerDeps> {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  // RFC-027: the agent's declared scope now binds — it must include what it uses.
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
  let n = 0;
  return {
    store,
    tokens: new FakeTokens("good-token", { sphereId: "sph_1", agentId: "agt_0", secretRef: "secret://sphere-mcp/sph_1/agt_0" }),
    executor,
    auditSink: new InMemoryAuditSink(),
    approvals: new InMemoryApprovalStore(),
    newApprovalId: () => "apr_1",
    newCorrelationId: () => `cor_${++n}`,
    now: () => NOW,
  };
}

describe("Sphere MCP server (RFC-007, ADR-007)", () => {
  it("rejects an unknown bearer token (fail closed)", async () => {
    const deps = await seed();
    const res = await handleSphereMcpRpc({ sphereId: "sph_1", token: "nope", request: { id: 1, method: "tools/list" } }, deps);
    expect(res.error?.code).toBe(-32000);
  });

  it("refuses a token minted for another Sphere even on the right path", async () => {
    const deps = await seed();
    deps.tokens.resolve = () => ({ sphereId: "sph_other", agentId: "agt_0", secretRef: "x" });
    const res = await handleSphereMcpRpc({ sphereId: "sph_1", token: "good-token", request: { id: 1, method: "tools/list" } }, deps);
    expect(res.error?.code).toBe(-32000);
  });

  it("completes the MCP lifecycle handshake (initialize + initialized + ping)", async () => {
    const deps = await seed();
    const init = await handleSphereMcpRpc(
      {
        sphereId: "sph_1",
        token: "good-token",
        request: { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      },
      deps,
    );
    const r = init.result as { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    expect(r.protocolVersion).toBe("2025-06-18");
    expect(r.serverInfo.name).toBe("kinos-sphere-mcp");
    // The notification + ping are token-authenticated no-ops.
    const note = await handleSphereMcpRpc({ sphereId: "sph_1", token: "good-token", request: { method: "notifications/initialized" } }, deps);
    expect(note.error).toBeUndefined();
    const ping = await handleSphereMcpRpc({ sphereId: "sph_1", token: "good-token", request: { id: 2, method: "ping" } }, deps);
    expect(ping.result).toEqual({});
  });

  it("rejects initialize without a valid token (handshake is authenticated)", async () => {
    const deps = await seed();
    const res = await handleSphereMcpRpc({ sphereId: "sph_1", token: "nope", request: { id: 1, method: "initialize" } }, deps);
    expect(res.error?.code).toBe(-32000);
  });

  it("tools/list returns only the calling agent's authorized surface", async () => {
    const deps = await seed();
    const res = await handleSphereMcpRpc({ sphereId: "sph_1", token: "good-token", request: { id: 1, method: "tools/list" } }, deps);
    const tools = (res.result as { tools: Array<{ name: string; inputSchema: { type: string } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(["memory.search"]);
    // MCP requires an inputSchema on every tool (real Hermes client validates it).
    expect(tools[0]?.inputSchema?.type).toBe("object");
  });

  it("tools/call executes an authorized capability and returns its output", async () => {
    const deps = await seed();
    const res = await handleSphereMcpRpc(
      { sphereId: "sph_1", token: "good-token", request: { id: 2, method: "tools/call", params: { name: "memory.search", arguments: { q: "x" } } } },
      deps,
    );
    const result = res.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ tool: "mem.search", input: { q: "x" } });
  });

  it("tools/call denies a capability the agent is not authorized for (deny by default)", async () => {
    const deps = await seed();
    const res = await handleSphereMcpRpc(
      { sphereId: "sph_1", token: "good-token", request: { id: 3, method: "tools/call", params: { name: "payment.execute" } } },
      deps,
    );
    expect((res.result as { isError: boolean }).isError).toBe(true);
  });
});
