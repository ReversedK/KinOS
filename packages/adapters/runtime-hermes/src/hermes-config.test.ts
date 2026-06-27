import { describe, expect, it } from "vitest";

import type { RuntimeConfigProjection } from "@kinos/core";
import { projectionToHermesConfig, toYaml, writeHermesProfile, type HermesFsPort } from "./hermes-config.js";

const projection: RuntimeConfigProjection = {
  agentId: "agt_0",
  sphereId: "sph_1",
  profile: { providerId: "ollama", model: "llama3.2", execution: "local" },
  gateway: {
    endpoint: "mcp+local://spheres/sph_1",
    authSecretRef: "secret://sphere-mcp/agt_0",
    allowedTools: ["memory.search", "calendar.read"],
  },
  nativeToolsAllow: [],
  autonomousInstallDisabled: true,
  version: 1,
};

describe("Hermes config projection (RFC-007)", () => {
  it("maps to exactly one Sphere MCP with the allowed-tools surface, install disabled", () => {
    const cfg = projectionToHermesConfig(projection);
    expect(cfg.mcp_servers).toHaveLength(1);
    expect(cfg.mcp_servers[0]?.name).toBe("sphere");
    expect(cfg.mcp_servers[0]?.allowed_tools).toEqual(["memory.search", "calendar.read"]);
    expect(cfg.autonomous_mcp_install).toBe(false);
  });

  it("writes the credential as a reference only, never a value", () => {
    const cloud: RuntimeConfigProjection = {
      ...projection,
      profile: { providerId: "openai", model: "gpt-4o-mini", execution: "cloud", secretRef: "secret://openai/key" },
    };
    const yaml = toYaml(projectionToHermesConfig(cloud));
    expect(yaml).toContain("api_key_secret_ref: secret://openai/key");
    expect(yaml).toContain("auth_secret_ref: secret://sphere-mcp/agt_0");
    expect(yaml).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("writes one config.yaml per profile under the Hermes home", async () => {
    const written: Record<string, string> = {};
    const dirs: string[] = [];
    const fs: HermesFsPort = {
      async mkdir(p) {
        dirs.push(p);
      },
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    const path = await writeHermesProfile(projection, { home: "/home/hermes/.hermes/", fs });
    expect(path).toBe("/home/hermes/.hermes/agt_0/config.yaml");
    expect(dirs).toContain("/home/hermes/.hermes/agt_0");
    expect(written[path]).toContain("name: sphere");
  });
});
