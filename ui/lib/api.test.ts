import { describe, expect, it } from "vitest";

import {
  createSession,
  denyApproval,
  executeCapability,
  getAgents,
  getAgentRuntimeProjection,
  getMembers,
  getPendingApprovals,
  getInstalledPackages,
  getIntegrations,
  getRuntime,
  getSession,
  getSphere,
  getSpheres,
  getStoreCatalog,
  grantApproval,
  installStorePackage,
  listSessions,
  postChatTurn,
  projectAgentRuntimeConfig,
  setIntegrationEnabled,
  setPackageEnabled,
  setRuntime,
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
      undefined,
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

  it("getRuntime returns the resolved runtime profile", async () => {
    const out = await getRuntime(
      "http://x",
      "sph_1",
      fakeFetch({
        provider: "ollama",
        model: "llama3.2",
        execution: "local",
        cloudInferenceEnabled: false,
        allowedProviders: ["ollama"],
        allowed: true,
        harness: { runtime: "hermes", provider: "ollama", model: "gemma4-128k", baseUrl: "http://hermes:8642/v1" },
      }),
    );
    expect(out).toMatchObject({ provider: "ollama", execution: "local", allowed: true });
    expect(out.harness).toMatchObject({ runtime: "hermes", model: "gemma4-128k" });
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
      undefined,
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
      undefined,
      fakeFetch({ code: "forbidden", message: "denied" }, 403),
    );
    expect(out).toMatchObject({ code: "forbidden" });
  });

  it("executeCapability throws when execution is disabled (501)", async () => {
    await expect(
      executeCapability("http://x", "sph_1", "calendar.create_event", { role: "parent", ageProfile: "adult" }, undefined, fakeFetch({}, 501)),
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

  it("setRuntime POSTs subject + profile and returns the outcome", async () => {
    const { impl, calls } = capturingFetch({ status: "executed", provider: "ollama", model: "mistral", execution: "local" });
    const out = await setRuntime(
      "http://x",
      "sph_1",
      { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      { providerId: "ollama", model: "mistral", execution: "local" },
      impl,
    );
    expect(out).toMatchObject({ status: "executed", model: "mistral" });
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/runtime");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      profile: { providerId: "ollama", model: "mistral", execution: "local" },
    });
  });

  it("setRuntime returns a denial (403) instead of throwing", async () => {
    const out = await setRuntime(
      "http://x",
      "sph_1",
      { role: "child", ageProfile: "child" },
      { providerId: "ollama", model: "mistral", execution: "local" },
      fakeFetch({ code: "forbidden", message: "denied" }, 403),
    );
    expect(out).toMatchObject({ code: "forbidden" });
  });

  it("projectAgentRuntimeConfig POSTs the governed runtime.config.project capability", async () => {
    const { impl, calls } = capturingFetch({
      status: "executed",
      output: { agentId: "agt_0", version: 1, allowedTools: ["memory.search"], configPath: "/opt/data/profiles/agt_0/config.yaml" },
    });
    const out = await projectAgentRuntimeConfig(
      "http://x",
      "sph_1",
      { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      { agentId: "agt_0" },
      impl,
    );
    expect(out).toMatchObject({ status: "executed" });
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/capabilities/runtime.config.project/execute");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      input: { agentId: "agt_0" },
    });
  });

  it("getAgentRuntimeProjection returns the preview payload", async () => {
    const out = await getAgentRuntimeProjection(
      "http://x",
      "sph_1",
      "agt_0",
      { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      fakeFetch({
        agentId: "agt_0",
        provider: "ollama",
        model: "qwen2.5:7b",
        execution: "local",
        gatewayEndpoint: "http://x/spheres/sph_1/mcp",
        authSecretRef: "secret://sphere-mcp/sph_1/agt_0",
        allowedTools: ["memory.search"],
        nativeToolsetsAllow: [],
        autonomousInstallDisabled: true,
      }),
    );
    expect(out.agentId).toBe("agt_0");
    expect(out.allowedTools).toEqual(["memory.search"]);
  });

  // --- package store (RFC-002) ---

  it("getStoreCatalog returns the catalog", async () => {
    const out = await getStoreCatalog("http://x", fakeFetch({ packages: [{ id: "p1", type: "skill", title: "P", description: "d", version: "1", publisher: "k", ageRating: "all", dependencies: [], providesCapabilities: [] }] }));
    expect(out[0]?.id).toBe("p1");
  });

  it("getInstalledPackages returns installed summaries", async () => {
    const out = await getInstalledPackages("http://x", "sph_1", fakeFetch({ packages: [{ id: "p1", type: "skill", title: "P", description: "d", status: "installed" }] }));
    expect(out[0]?.status).toBe("installed");
  });

  it("installStorePackage posts the packageId and returns the outcome", async () => {
    const { impl, calls } = capturingFetch({ id: "family-calendar", status: "installed" });
    const out = await installStorePackage("http://x", "sph_1", { memberId: "mbr_p1", role: "parent", ageProfile: "adult" }, "family-calendar", impl);
    expect(out).toMatchObject({ id: "family-calendar", status: "installed" });
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/packages/install");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ packageId: "family-calendar" });
  });

  it("installStorePackage returns a denial (403) instead of throwing", async () => {
    const out = await installStorePackage("http://x", "sph_1", { role: "child", ageProfile: "child" }, "p1", fakeFetch({ code: "forbidden" }, 403));
    expect(out).toMatchObject({ code: "forbidden" });
  });

  it("setPackageEnabled posts to enable/disable", async () => {
    const { impl, calls } = capturingFetch({ id: "p1", status: "enabled" });
    await setPackageEnabled("http://x", "sph_1", "p1", true, { role: "parent", ageProfile: "adult" }, impl);
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/packages/p1/enable");
  });

  // --- connectors (integration-model) ---

  it("getIntegrations returns the summaries", async () => {
    const out = await getIntegrations(
      "http://x",
      "sph_1",
      fakeFetch({ integrations: [{ id: "int_1", provider: "google", status: "proposed", scopes: [], providesCapabilities: [] }] }),
    );
    expect(out[0]?.provider).toBe("google");
  });

  it("setIntegrationEnabled posts to enable/disable and returns the outcome", async () => {
    const { impl, calls } = capturingFetch({ id: "int_1", status: "enabled" });
    const out = await setIntegrationEnabled("http://x", "sph_1", "int_1", true, { memberId: "mbr_p1", role: "parent", ageProfile: "adult" }, impl);
    expect(out).toMatchObject({ id: "int_1", status: "enabled" });
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/integrations/int_1/enable");
    const off = capturingFetch({ id: "int_1", status: "disabled" });
    await setIntegrationEnabled("http://x", "sph_1", "int_1", false, { role: "parent", ageProfile: "adult" }, off.impl);
    expect(off.calls[0]?.url).toBe("http://x/spheres/sph_1/integrations/int_1/disable");
  });

  it("setIntegrationEnabled returns a denial (403) instead of throwing", async () => {
    const out = await setIntegrationEnabled("http://x", "sph_1", "int_1", true, { role: "child", ageProfile: "child" }, fakeFetch({ code: "forbidden" }, 403));
    expect(out).toMatchObject({ code: "forbidden" });
  });

  // --- chat sessions (RFC-005) ---

  it("listSessions returns the owner's summaries", async () => {
    const out = await listSessions(
      "http://x",
      "sph_1",
      "mbr_p1",
      fakeFetch({ sessions: [{ id: "ses_1", title: "Plans", agentId: "agt_1", state: "active", updatedAt: "t", messageCount: 2 }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("ses_1");
  });

  it("getSession requests the owner-scoped transcript", async () => {
    const { impl, calls } = capturingFetch({ id: "ses_1", title: "Plans", agentId: "agt_1", state: "active", updatedAt: "t", messages: [] });
    const out = await getSession("http://x", "sph_1", "ses_1", "mbr_p1", impl);
    expect(out.id).toBe("ses_1");
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/sessions/ses_1?ownerId=mbr_p1");
  });

  it("createSession POSTs the subject + agentId and returns the new session", async () => {
    const { impl, calls } = capturingFetch({ id: "ses_1", title: "Plans", agentId: "agt_1", ownerId: "mbr_p1", state: "active" });
    const out = await createSession("http://x", "sph_1", { memberId: "mbr_p1", role: "parent", ageProfile: "adult" }, "agt_1", "Plans", impl);
    expect(out.id).toBe("ses_1");
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/sessions");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      subject: { memberId: "mbr_p1", role: "parent", ageProfile: "adult" },
      agentId: "agt_1",
      title: "Plans",
    });
  });

  it("postChatTurn POSTs the text and returns the reply", async () => {
    const { impl, calls } = capturingFetch({ sessionId: "ses_1", reply: "hello back", messageCount: 2 });
    const out = await postChatTurn("http://x", "sph_1", "ses_1", { memberId: "mbr_p1", role: "parent", ageProfile: "adult" }, "hi", impl);
    expect(out.reply).toBe("hello back");
    expect(calls[0]?.url).toBe("http://x/spheres/sph_1/sessions/ses_1/messages");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ text: "hi" });
  });

  it("postChatTurn throws on a denial (403)", async () => {
    await expect(
      postChatTurn("http://x", "sph_1", "ses_1", { role: "parent", ageProfile: "adult" }, "hi", fakeFetch({}, 403)),
    ).rejects.toThrow(/failed: 403/);
  });
});
