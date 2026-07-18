import { describe, expect, it } from "vitest";

import { defaultCapabilityCatalog } from "../capability/catalog.js";
import type { Policy, PolicyRequest } from "../policy/types.js";
import { defaultRuntimeConfig } from "./profile.js";
import { projectAgentRuntimeConfig } from "./projection.js";

const ctx: PolicyRequest["context"] = {
  sphereId: "sph_1",
  time: "2026-06-27T10:00:00.000Z",
  execution: "local",
  correlationId: "cor_1",
};

const allowSearch: Policy = {
  id: "pol_search",
  sphereId: "sph_1",
  description: "Anyone may search memory.",
  subjectSelector: {},
  action: "execute",
  resourceSelector: { capabilityNames: ["memory.search"] },
  effect: "allow",
  priority: 0,
  version: 1,
  status: "active",
};

const base = {
  agentId: "agt_0",
  subject: { agentId: "agt_0", role: "parent", ageProfile: "adult" } as const,
  runtimeConfig: defaultRuntimeConfig(),
  catalog: defaultCapabilityCatalog(),
  context: ctx,
  gatewayEndpoint: "mcp+local://spheres/sph_1",
  authSecretRef: "secret://sphere-mcp/agt_0",
  version: 1,
};

describe("projectAgentRuntimeConfig (RFC-007)", () => {
  it("projects exactly one Sphere gateway whose allowedTools are the authorized surface", () => {
    const p = projectAgentRuntimeConfig({ ...base, policies: [allowSearch] });
    expect(p.gateway.endpoint).toBe(base.gatewayEndpoint);
    expect(p.gateway.allowedTools).toEqual(["memory.search"]);
    // The profile comes from the Sphere config (RFC-004) — local-first by default.
    expect(p.profile.providerId).toBe("ollama");
    expect(p.profile.execution).toBe("local");
  });

  it("carries the per-agent credential only by reference, never a value", () => {
    const p = projectAgentRuntimeConfig({ ...base, policies: [allowSearch] });
    expect(p.gateway.authSecretRef).toBe("secret://sphere-mcp/agt_0");
    expect(JSON.stringify(p)).not.toMatch(/BEGIN|password|sk-/i);
  });

  it("is deny-by-default: empty allowedTools and native toolsets, install disabled", () => {
    const p = projectAgentRuntimeConfig({ ...base, policies: [] });
    expect(p.gateway.allowedTools).toEqual([]);
    expect(p.nativeToolsetsAllow).toEqual([]);
    expect(p.autonomousInstallDisabled).toBe(true);
  });

  it("splits authorized capabilities into MCP tools vs native toolsets (RFC-025)", () => {
    // Grant one MCP capability (memory.search) and one native toolset (native.web).
    const allowWeb: Policy = { ...allowSearch, id: "pol_web", resourceSelector: { capabilityNames: ["native.web"] } };
    const bindings = [
      { capability: "memory.search", runtime: "local" as const, runtimeToolName: "local.memory_search", execution: "local" as const, risk: "low" as const, requiresApproval: false, status: "enabled" as const },
      { capability: "native.web", runtime: "hermes" as const, runtimeToolName: "web", execution: "local" as const, risk: "medium" as const, requiresApproval: false, status: "enabled" as const },
    ];
    const p = projectAgentRuntimeConfig({ ...base, policies: [allowSearch, allowWeb], bindings });
    // native.* goes to the native channel as a toolset name, never to the MCP surface.
    expect(p.gateway.allowedTools).toEqual(["memory.search"]);
    expect(p.nativeToolsetsAllow).toEqual(["web"]);
  });

  it("rejects a projection without a per-agent credential reference (deny by default)", () => {
    expect(() => projectAgentRuntimeConfig({ ...base, authSecretRef: "  ", policies: [] })).toThrow(/credential|reference/i);
  });

  it("an agent model preference does a boring model swap, never escalating provider/execution", () => {
    const p = projectAgentRuntimeConfig({ ...base, policies: [allowSearch], agentModelPreference: "qwen2.5" });
    expect(p.profile.model).toBe("qwen2.5");
    expect(p.profile.providerId).toBe("ollama");
    expect(p.profile.execution).toBe("local");
  });
});
