import { describe, expect, it } from "vitest";

import { getPendingApprovals, getSphere, getSpheres } from "./api";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
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

  it("throws on a non-ok response", async () => {
    await expect(getSpheres("http://x", fakeFetch({}, 500))).rejects.toThrow(/failed: 500/);
  });
});
