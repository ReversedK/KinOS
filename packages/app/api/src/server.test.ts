import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySphereStore,
  createSphere,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type Policy,
} from "@kinos/core";

import { createApiServer } from "./server.js";
import type { ApiDeps } from "./router.js";

const NOW = "2026-06-25T10:00:00.000Z";

async function buildDeps(): Promise<ApiDeps> {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy", role: "parent" },
  });
  const policies: Policy[] = [
    {
      id: "pol_cal",
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
  await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies, bindings, exportedAt: NOW }));
  const audit = new InMemoryAuditSink();
  const executor: CapabilityExecutor = { async execute() { return { ok: true }; } };
  let n = 0;
  let a = 0;
  return {
    store,
    approvals: new InMemoryApprovalStore(),
    audit,
    auditSink: audit,
    executor,
    newCorrelationId: () => `req_${++n}`,
    newApprovalId: () => `apr_${++a}`,
    now: () => NOW,
  };
}

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(): Promise<number> {
  server = createApiServer(await buildDeps());
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as AddressInfo).port;
}

describe("createApiServer (HTTP)", () => {
  it("serves /health with a correlation-id header", async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-correlation-id")).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("serves a sphere summary and 404s a missing one", async () => {
    const port = await start();
    const ok = await fetch(`http://localhost:${port}/spheres/sph_1`);
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { id: string }).toMatchObject({ id: "sph_1", name: "Doe Family" });

    const missing = await fetch(`http://localhost:${port}/spheres/nope`);
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { code: string }).toMatchObject({ code: "not_found" });
  });

  it("executes a governed capability over HTTP (POST with a JSON body)", async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/spheres/sph_1/capabilities/calendar.create_event/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "executed" });
  });

  it("denies a child's governed capability over HTTP (403)", async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/spheres/sph_1/capabilities/calendar.create_event/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: { memberId: "mbr_c1", role: "child", ageProfile: "child" } }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "forbidden" });
  });
});
