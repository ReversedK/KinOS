import { describe, expect, it } from "vitest";

import type { RuntimeConfigProjection } from "@kinos/core";
import {
  SPHERE_MCP_TOKEN_ENV,
  projectionToHermesConfig,
  toYaml,
  writeHermesProfile,
  type HermesFsPort,
} from "./hermes-config.js";

const projection: RuntimeConfigProjection = {
  agentId: "agt_0",
  sphereId: "sph_1",
  profile: { providerId: "ollama", model: "llama3.2", execution: "local" },
  gateway: {
    endpoint: "http://api:8787/spheres/sph_1/mcp",
    authSecretRef: "secret://sphere-mcp/sph_1/agt_0",
    allowedTools: ["memory.search", "calendar.read"],
  },
  nativeToolsAllow: [],
  autonomousInstallDisabled: true,
  version: 1,
};

describe("Hermes config projection — real schema (RFC-007/ADR-007)", () => {
  it("emits mcp_servers as a map with one 'sphere' HTTP server (url + tools.include)", () => {
    const cfg = projectionToHermesConfig(projection);
    expect(Object.keys(cfg.mcp_servers)).toEqual(["sphere"]);
    expect(cfg.mcp_servers.sphere?.url).toBe("http://api:8787/spheres/sph_1/mcp");
    expect(cfg.mcp_servers.sphere?.tools.include).toEqual(["memory.search", "calendar.read"]);
    expect(cfg.autonomous_mcp_install).toBe(false);
    // Real Hermes model section, not a bespoke "runtime" key.
    expect(cfg.model.default).toBe("llama3.2");
    expect(cfg.model.provider).toBe("ollama");
  });

  it("authenticates via an Authorization header that references an env var, never an inline value", () => {
    const yaml = toYaml(projectionToHermesConfig(projection));
    expect(yaml).toContain(`Authorization: "Bearer \${${SPHERE_MCP_TOKEN_ENV}}"`);
    // The secret value/ref is not inlined into config.yaml.
    expect(yaml).not.toContain("secret://sphere-mcp");
    expect(yaml).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("references a cloud provider key by env var when the profile is cloud", () => {
    const cloud: RuntimeConfigProjection = {
      ...projection,
      profile: { providerId: "openai", model: "gpt-4o-mini", execution: "cloud", secretRef: "secret://openai/key" },
    };
    const yaml = toYaml(projectionToHermesConfig(cloud));
    expect(yaml).toContain('api_key: "${OPENAI_API_KEY}"');
    expect(yaml).not.toContain("secret://openai/key");
  });

  it("writes config.yaml plus a .env holding the token when a token is supplied (ADR-007)", async () => {
    const written: Record<string, string> = {};
    const fs: HermesFsPort = {
      async mkdir() {},
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    const path = await writeHermesProfile(projection, { home: "/opt/data/", fs, token: "tok-secret-value" });
    expect(path).toBe("/opt/data/agt_0/config.yaml");
    expect(written["/opt/data/agt_0/config.yaml"]).toContain("sphere:");
    // The token value lands ONLY in the profile .env, never in config.yaml.
    expect(written["/opt/data/agt_0/.env"]).toBe(`${SPHERE_MCP_TOKEN_ENV}=tok-secret-value\n`);
    expect(written["/opt/data/agt_0/config.yaml"]).not.toContain("tok-secret-value");
  });

  it("a preview (no token) writes config.yaml only — no .env, no secret on disk", async () => {
    const written: Record<string, string> = {};
    const fs: HermesFsPort = {
      async mkdir() {},
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    await writeHermesProfile(projection, { home: "/opt/data", fs });
    expect(Object.keys(written)).toEqual(["/opt/data/agt_0/config.yaml"]);
  });
});
