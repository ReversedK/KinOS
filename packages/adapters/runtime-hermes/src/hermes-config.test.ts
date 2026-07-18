import { describe, expect, it } from "vitest";

import type { RuntimeConfigProjection } from "@kinos/core";
import {
  HERMES_MIN_CONTEXT_LENGTH,
  SPHERE_MCP_TOKEN_ENV,
  mergeHermesConfig,
  mergeHermesEnv,
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
  nativeToolsetsAllow: [],
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

  it("carries the governed provider/model into the Hermes model block (ADR-008 §4)", () => {
    const governed: RuntimeConfigProjection = {
      ...projection,
      profile: { providerId: "ollama", model: "gemma4-128k", execution: "local", baseUrl: "http://host.docker.internal:11434" },
    };
    const cfg = projectionToHermesConfig(governed);
    expect(cfg.model.default).toBe("gemma4-128k");
    expect(cfg.model.provider).toBe("ollama");
    // Hermes' ollama provider speaks /v1; a bare :11434 base_url 404s.
    expect(cfg.model.base_url).toBe("http://host.docker.internal:11434/v1");
    // Hermes refuses <64K; a projected profile without it is rejected.
    expect(cfg.model.context_length).toBe(HERMES_MIN_CONTEXT_LENGTH);
  });

  it("does not double-suffix a base URL that already ends in /v1", () => {
    const governed: RuntimeConfigProjection = {
      ...projection,
      profile: { providerId: "ollama", model: "m", execution: "local", baseUrl: "http://ollama:11434/v1/" },
    };
    expect(projectionToHermesConfig(governed).model.base_url).toBe("http://ollama:11434/v1");
  });

  it("serializes context_length as a YAML number, not a quoted string", () => {
    const yaml = toYaml(projectionToHermesConfig(projection));
    expect(yaml).toContain(`context_length: ${HERMES_MIN_CONTEXT_LENGTH}`);
    expect(yaml).not.toContain(`context_length: "${HERMES_MIN_CONTEXT_LENGTH}"`);
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
      async readFile() {
        return undefined;
      },
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    const path = await writeHermesProfile(projection, { home: "/opt/data/", fs, token: "tok-secret-value" });
    expect(path).toBe("/opt/data/profiles/agt_0/config.yaml");
    expect(written["/opt/data/profiles/agt_0/config.yaml"]).toContain("sphere:");
    // The token value lands ONLY in the profile .env, never in config.yaml.
    expect(written["/opt/data/profiles/agt_0/.env"]).toBe(`${SPHERE_MCP_TOKEN_ENV}=tok-secret-value\n`);
    expect(written["/opt/data/profiles/agt_0/config.yaml"]).not.toContain("tok-secret-value");
  });

  it("a preview (no token) writes config.yaml only — no .env, no secret on disk", async () => {
    const written: Record<string, string> = {};
    const fs: HermesFsPort = {
      async mkdir() {},
      async readFile() {
        return undefined;
      },
      async writeFile(p, c) {
        written[p] = c;
      },
    };
    await writeHermesProfile(projection, { home: "/opt/data", fs });
    expect(Object.keys(written)).toEqual(["/opt/data/profiles/agt_0/config.yaml"]);
  });

  it("merges governed sections into an existing Hermes config without erasing channel settings", () => {
    const existing = [
      "platforms:",
      "  telegram:",
      "    enabled: true",
      "telegram:",
      "  allowed_chats: \"1234\"",
      "mcp_servers:",
      "  github:",
      "    url: https://example.test/mcp",
      "    enabled: true",
      "platform_toolsets:",
      "  api_server:",
      "    - terminal",
      "",
    ].join("\n");
    const merged = mergeHermesConfig(existing, projection);
    expect(merged).toContain("platforms:");
    expect(merged).toContain("telegram:");
    expect(merged).toContain('allowed_chats: "1234"');
    expect(merged).toContain("sphere:");
    expect(merged).not.toContain("github:");
    // KinOS owns toolset governance: a stray platform_toolsets [terminal] is replaced
    // by the projected deny-by-default block (empty grant here), and terminal is floored.
    expect(merged).not.toMatch(/api_server:\n\s+- terminal/);
    expect(merged).toMatch(/disabled_toolsets:[\s\S]*terminal/);
  });

  it("grants via the real per-platform key, hard-floors the dangerous set (RFC-025)", () => {
    const granted: RuntimeConfigProjection = { ...projection, nativeToolsetsAllow: ["web", "cron", "media"] };
    const cfg = projectionToHermesConfig(granted);
    // Grant is the exclusive per-platform list — real Hermes toolset names.
    // cron → cronjob; media → vision/image_gen/tts; NOT the unread agent.enabled_toolsets.
    expect(cfg.platform_toolsets.api_server).toEqual(["web", "cronjob", "vision", "image_gen", "tts"]);
    expect("enabled_toolsets" in cfg.agent).toBe(false);
    // The hard floor is always in the global disabled_toolsets master subtraction.
    for (const floored of ["memory", "terminal", "file", "code_execution", "computer_use", "delegation"]) {
      expect(cfg.agent.disabled_toolsets).toContain(floored);
    }
    // Every ungranted configurable toolset is disabled too — an empty grant otherwise
    // falls through to Hermes' defaults (verified live). Granted ones are NOT disabled.
    expect(cfg.agent.disabled_toolsets).toContain("browser");
    for (const grantedTs of ["web", "cronjob", "vision", "image_gen", "tts"]) {
      expect(cfg.agent.disabled_toolsets).not.toContain(grantedTs);
    }
    // No grant → empty per-platform list AND every configurable disabled (deny-all).
    const none = projectionToHermesConfig(projection);
    expect(none.platform_toolsets.api_server).toEqual([]);
    expect(none.agent.disabled_toolsets).toContain("memory");
    expect(none.agent.disabled_toolsets).toContain("web");
  });

  it("merges the Sphere MCP token into an existing .env without dropping Hermes credentials", () => {
    const merged = mergeHermesEnv("TELEGRAM_BOT_TOKEN=tg-secret\nOPENAI_API_KEY=sk-live\n", {
      [SPHERE_MCP_TOKEN_ENV]: "tok-secret-value",
    });
    expect(merged).toContain("TELEGRAM_BOT_TOKEN=tg-secret\n");
    expect(merged).toContain("OPENAI_API_KEY=sk-live\n");
    expect(merged).toContain(`${SPHERE_MCP_TOKEN_ENV}=tok-secret-value\n`);
  });
});
