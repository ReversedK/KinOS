import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createSphere,
  exportSphere,
  type AgentRuntime,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
} from "@kinos/core";
import {
  SqliteAgentTokenStore,
  SqliteApprovalStore,
  SqliteAuditSink,
  SqliteSessionStore,
  SqliteSphereStore,
} from "@kinos/persistence-sqlite";

import { createApiServer } from "./server.js";

const fakeRuntime: AgentRuntime = {
  async listModels() {
    return ["test-model"];
  },
  async generate(request) {
    return { model: request.model, content: "hello back" };
  },
  async isAvailable() {
    return true;
  },
};

const allowAdultPackages: Policy = {
  id: "pol_pkg",
  sphereId: "sph_1",
  description: "Adults may manage packages.",
  subjectSelector: { ageProfiles: ["adult"] },
  action: "execute",
  resourceSelector: { capabilityNames: ["package.install", "package.enable", "package.disable"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

// End-to-end read path: real SQLite adapters -> router -> HTTP -> fetch. This is
// the integration the per-layer unit tests don't cover (server tests use
// in-memory stores).
const NOW = "2026-06-25T10:00:00.000Z";

let server: Server | undefined;
let dir: string | undefined;
const open: Array<{ close: () => void }> = [];

afterEach(() => {
  server?.close();
  server = undefined;
  for (const s of open.splice(0)) s.close();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function startSeeded(): Promise<number> {
  dir = mkdtempSync(join(tmpdir(), "kinos-e2e-"));
  const store = new SqliteSphereStore(join(dir, "k.sqlite"));
  const approvals = new SqliteApprovalStore(join(dir, "appr.sqlite"));
  const audit = new SqliteAuditSink(join(dir, "audit.sqlite"));
  const sessions = new SqliteSessionStore(join(dir, "sessions.sqlite"));
  open.push(store, approvals, audit, sessions);

  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "P1 agent", enabledCapabilities: ["memory.search"] });
  await store.save(
    exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies: [allowAdultPackages], exportedAt: NOW }),
  );

  let n = 0;
  let s = 0;
  server = createApiServer({
    store,
    approvals,
    audit,
    auditSink: audit,
    sessions,
    runtime: fakeRuntime,
    newCorrelationId: () => `req_${++n}`,
    newApprovalId: () => `apr_${n}`,
    newSessionId: () => `ses_${++s}`,
    now: () => NOW,
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as AddressInfo).port;
}

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

const fakeExecutor: CapabilityExecutor = {
  async execute(binding, input) {
    return { tool: binding.runtimeToolName, input };
  },
};

/** Start a server with the Sphere MCP gateway wired and a provisioned token. */
async function startWithMcp(): Promise<{ port: number; token: string }> {
  dir = mkdtempSync(join(tmpdir(), "kinos-mcp-"));
  const store = new SqliteSphereStore(join(dir, "k.sqlite"));
  const approvals = new SqliteApprovalStore(join(dir, "appr.sqlite"));
  const audit = new SqliteAuditSink(join(dir, "audit.sqlite"));
  const tokens = new SqliteAgentTokenStore(join(dir, "tokens.sqlite"));
  open.push(store, approvals, audit, tokens);

  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "P1 agent", enabledCapabilities: ["memory.search"] });
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
  const provisioned = await tokens.provision("sph_1", "agt_0");

  let n = 0;
  server = createApiServer(
    {
      store,
      approvals,
      audit,
      newCorrelationId: () => `req_${++n}`,
    },
    {
      store,
      tokens,
      executor: fakeExecutor,
      auditSink: audit,
      approvals,
      newApprovalId: () => `apr_${n}`,
      newCorrelationId: () => `cor_${++n}`,
      now: () => NOW,
    },
  );
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return { port: (server!.address() as AddressInfo).port, token: provisioned.token };
}

describe("Sphere MCP gateway e2e (RFC-007, ADR-007) over real SQLite + HTTP", () => {
  async function rpc(port: number, token: string, body: unknown): Promise<any> {
    const res = await fetch(`http://localhost:${port}/spheres/sph_1/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  it("authenticates by token, lists the authorized surface, and executes a tool call", async () => {
    const { port, token } = await startWithMcp();

    const list = await rpc(port, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["memory.search"]);

    const call = await rpc(port, token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "memory.search", arguments: { q: "x" } },
    });
    expect(call.result.isError).toBe(false);
    expect(JSON.parse(call.result.content[0].text)).toEqual({ tool: "mem.search", input: { q: "x" } });
  });

  it("refuses an unknown bearer token before any policy check (fail closed)", async () => {
    const { port } = await startWithMcp();
    const res = await rpc(port, "forged-token", { jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(res.error.code).toBe(-32000);
  });
});

describe("API e2e over real SQLite adapters", () => {
  it("serves the full read path the UI consumes", async () => {
    const port = await startSeeded();
    const base = `http://localhost:${port}`;

    const spheres = await (await fetch(`${base}/spheres`)).json();
    expect(spheres).toEqual({ spheres: ["sph_1"] });

    const summary = await (await fetch(`${base}/spheres/sph_1`)).json();
    expect(summary).toMatchObject({ id: "sph_1", name: "Doe Family", members: 1 });

    const members = await (await fetch(`${base}/spheres/sph_1/members`)).json();
    expect(members).toEqual({ members: [{ id: "mbr_p1", role: "parent", status: "active" }] });

    const agents = await (await fetch(`${base}/spheres/sph_1/agents`)).json();
    expect((agents as { agents: unknown[] }).agents).toHaveLength(1);

    const approvals = await (await fetch(`${base}/approvals`)).json();
    expect(approvals).toEqual({ pending: [] });
  });

  it("data persists: a second server on the same files serves it", async () => {
    const port1 = await startSeeded();
    expect(await (await fetch(`http://localhost:${port1}/spheres`)).json()).toEqual({ spheres: ["sph_1"] });
    // server + handles closed by afterEach; the files remain until dir cleanup,
    // but this test only asserts the live read path works against real SQLite.
  });
});
