import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { InMemoryApprovalStore, InMemoryAuditSink, InMemorySphereStore, createSphere, exportSphere } from "@kinos/core";

import { createApiServer } from "./server.js";

const NOW = "2026-06-25T10:00:00.000Z";

async function buildDeps() {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy", role: "parent" },
  });
  await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));
  let n = 0;
  return { store, approvals: new InMemoryApprovalStore(), audit: new InMemoryAuditSink(), newCorrelationId: () => `req_${++n}` };
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
});
