import { describe, expect, it } from "vitest";

import {
  denyApproval,
  executeCapability,
  getAgents,
  getMembers,
  getPendingApprovals,
  getSphere,
  getSpheres,
  grantApproval,
} from "./api";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

/** Capturing fake: records the request and returns a canned status + body. */
function capturingFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("UI API client", () => {
  it("getSpheres returns the ids", async () => {
    const out = await getSpheres("http://x", fakeFetch({ spheres: ["sph_1", "sph_2"] }));
    expect(out).toEqual(["sph_1", "sph_2"]);
  });

  it("getSphere returns the summary", async () => {
    const out = await getSphere(
      "http://x",
      "sph_1",
      fakeFetch({ id: "sph_1", name: "Doe", type: "family", status: "active", members: 3, identities: 2 }),
    );
    expect(out).toMatchObject({ id: "sph_1", members: 3 });
  });

  it("getPendingApprovals returns the list", async () => {
    const out = await getPendingApprovals(
      "http://x",
      fakeFetch({ pending: [{ id: "apr_1", sphereId: "sph_1", capability: "payment.execute", state: "pending", approverRoles: ["parent"] }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.capability).toBe("payment.execute");
  });

  it("getMembers returns the member summaries", async () => {
    const out = await getMembers(
      "http://x",
      "sph_1",
      fakeFetch({ members: [{ id: "mbr_p1", role: "parent", status: "active" }] }),
    );
    expect(out).toEqual([{ id: "mbr_p1", role: "parent", status: "active" }]);
  });

  it("getAgents returns the agent summaries", async () => {
    const out = await getAgents(
      "http://x",
      "sph_1",
      fakeFetch({ agents: [{ id: "agt_0", name: "P1", ownerId: "mbr_p1", state: "configured", enabledCapabilities: [] }] }),
    );
    expect(out[0]?.name).toBe("P1");
  });

  it("throws on a non-ok response", async () => {
    await expect(getSpheres("http://x", fakeFetch({}, 500))).rejects.toThrow(/failed: 500/);
  });

  // --- governed write actions (RFC-003) ---

  it("executeCapability POSTs the subject and returns an executed outcome", async () => {
    const { impl, calls } = capturingFetch({ status: "executed", reason: "ok" });
    const out = await executeCapability(
      "http://x",
      "sph_1",
      "calendar.create_event",
      { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      impl,
    );
    expect(out).toMatchObject({ status: "executed" });
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/capabilities/calendar.create_event/execute");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
    });
  });

  it("executeCapability returns a denial (403) instead of throwing", async () => {
    const out = await executeCapability(
      "http://x",
      "sph_1",
      "calendar.create_event",
      { role: "child", ageProfile: "child" },
      fakeFetch({ code: "forbidden", message: "denied" }, 403),
    );
    expect(out).toMatchObject({ code: "forbidden" });
  });

  it("executeCapability throws when execution is disabled (501)", async () => {
    await expect(
      executeCapability("http://x", "sph_1", "calendar.create_event", { role: "parent", ageProfile: "adult" }, fakeFetch({}, 501)),
    ).rejects.toThrow(/failed: 501/);
  });

  it("grantApproval POSTs to the grant endpoint and returns the outcome", async () => {
    const { impl, calls } = capturingFetch({ approvalId: "apr_1", capability: "payment.execute", status: "executed" });
    const out = await grantApproval("http://x", "apr_1", { memberId: "mbr_p2", role: "parent" }, impl);
    expect(out).toMatchObject({ approvalId: "apr_1", status: "executed" });
    expect(calls[0]?.url).toBe("http://x/approvals/apr_1/grant");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ approver: { memberId: "mbr_p2", role: "parent" } });
  });

  it("denyApproval POSTs to the deny endpoint", async () => {
    const { impl, calls } = capturingFetch({ approvalId: "apr_1", capability: "payment.execute", status: "denied" });
    const out = await denyApproval("http://x", "apr_1", { memberId: "mbr_p2", role: "parent" }, impl);
    expect(out.status).toBe("denied");
    expect(calls[0]?.url).toBe("http://x/approvals/apr_1/deny");
  });

  it("grantApproval throws on a non-200 (e.g. 409 already resolved)", async () => {
    await expect(
      grantApproval("http://x", "apr_1", { memberId: "mbr_p2", role: "parent" }, fakeFetch({}, 409)),
    ).rejects.toThrow(/failed: 409/);
  });
});
