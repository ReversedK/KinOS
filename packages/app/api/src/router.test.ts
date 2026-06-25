import { describe, expect, it } from "vitest";
import {
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemorySphereStore,
  createApprovalFromDecision,
  createSphere,
  exportSphere,
  type PolicyDecision,
} from "@kinos/core";

import { handleApiRequest, type ApiDeps } from "./router.js";

const NOW = "2026-06-25T10:00:00.000Z";

async function deps(): Promise<ApiDeps & { audit: InMemoryAuditSink; approvals: InMemoryApprovalStore }> {
  const store = new InMemorySphereStore();
  const sphere = createSphere({
    id: "sph_1",
    type: "family",
    name: "Doe Family",
    founder: { memberId: "mbr_p1", identityId: "idy_p1", role: "parent" },
  });
  await store.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));

  const audit = new InMemoryAuditSink();
  audit.record({ type: "sphere.created", sphereId: "sph_1", resourceId: "sph_1", correlationId: "cor_x", createdAt: NOW });

  const approvals = new InMemoryApprovalStore();
  const decision: PolicyDecision = {
    effect: "require_approval",
    reason: "needs a parent",
    matchedPolicyId: "pol",
    matchedPolicyVersion: 1,
    approval: { approverRoles: ["parent"], expiresInSeconds: 3600 },
    correlationId: "cor_y",
  };
  await approvals.save({
    approval: createApprovalFromDecision({
      id: "apr_1",
      sphereId: "sph_1",
      decision,
      requestedBy: { agentId: "agt_0", onBehalfOf: "mbr_p1" },
      action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "pay" },
      createdAt: NOW,
    }),
    request: {
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      capabilityName: "payment.execute",
      context: { sphereId: "sph_1", time: NOW, execution: "local", correlationId: "cor_y" },
    },
  });

  let n = 0;
  return { store, approvals, audit, newCorrelationId: () => `req_${++n}` };
}

describe("API router (api-contract.md)", () => {
  it("every response carries a correlation id", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/health" }, await deps());
    expect(res.status).toBe(200);
    expect(res.correlationId).toBe("req_1");
  });

  it("lists spheres", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ spheres: ["sph_1"] });
  });

  it("gets a sphere summary", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/sph_1" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "sph_1", name: "Doe Family", members: 1 });
  });

  it("returns not_found for a missing sphere (with a correlation id)", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/spheres/nope" }, await deps());
    expect(res.status).toBe(404);
    expect(res.code).toBe("not_found");
    expect(res.correlationId).toBeTruthy();
  });

  it("lists pending approvals", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/approvals" }, await deps());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pending: [
        { id: "apr_1", sphereId: "sph_1", capability: "payment.execute", state: "pending", approverRoles: ["parent"] },
      ],
    });
  });

  it("returns an audit chain by correlation id", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/audit/cor_x" }, await deps());
    expect(res.status).toBe(200);
    expect((res.body as { events: unknown[] }).events).toHaveLength(1);
  });

  it("rejects a non-GET method", async () => {
    const res = await handleApiRequest({ method: "POST", path: "/spheres" }, await deps());
    expect(res.status).toBe(405);
    expect(res.code).toBe("invalid_request");
  });

  it("returns not_found for an unknown route", async () => {
    const res = await handleApiRequest({ method: "GET", path: "/nope" }, await deps());
    expect(res.status).toBe(404);
  });
});
