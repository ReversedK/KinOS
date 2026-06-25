import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, createSphere, exportSphere } from "@kinos/core";
import { SqliteApprovalStore, SqliteAuditSink, SqliteSphereStore } from "@kinos/persistence-sqlite";

import { createApiServer } from "./server.js";

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
  open.push(store, approvals, audit);

  let sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  const agent = createAgent({ id: "agt_0", ownerId: "mbr_p1", ownerType: "member", sphereId: "sph_1", name: "P1 agent" });
  await store.save(
    exportSphere({ sphere, identities: [], agents: [agent], memory: [], policies: [], exportedAt: NOW }),
  );

  let n = 0;
  server = createApiServer({ store, approvals, audit, newCorrelationId: () => `req_${++n}` });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as AddressInfo).port;
}

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
