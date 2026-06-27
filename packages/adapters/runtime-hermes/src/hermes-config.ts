/**
 * Hermes configuration projection writer (RFC-007).
 *
 * Realizes the provider-agnostic RuntimeConfigProjection (domain core) as a
 * Hermes profile: one `~/.hermes/<profile>/config.yaml` per principal, owned by
 * KinOS. The agent never edits this file. Consequences carried from the domain
 * projection (the core already enforced them; this only serializes them):
 *   - exactly one MCP server, the Sphere MCP, with its allowed-tools surface;
 *   - the per-agent credential is written as a reference, never a value;
 *   - native tools are a deny-by-default allow-list;
 *   - autonomous MCP install is disabled.
 *
 * Secrets stay by reference (secret-store.md): the projected YAML carries
 * `*_secret_ref` fields, never key material.
 */

import type { RuntimeConfigProjection } from "@kinos/core";

export interface HermesConfig {
  readonly runtime: {
    readonly provider: string;
    readonly model: string;
    readonly execution: string;
    readonly base_url?: string;
    readonly api_key_secret_ref?: string;
  };
  readonly mcp_servers: ReadonlyArray<{
    readonly name: string;
    readonly transport: string;
    readonly auth_secret_ref: string;
    readonly allowed_tools: readonly string[];
    readonly enabled: true;
  }>;
  readonly native_tools: { readonly allow: readonly string[] };
  readonly autonomous_mcp_install: false;
}

/** Pure mapping: a domain projection -> the Hermes config object. */
export function projectionToHermesConfig(projection: RuntimeConfigProjection): HermesConfig {
  const { profile, gateway } = projection;
  return {
    runtime: {
      provider: profile.providerId,
      model: profile.model,
      execution: profile.execution,
      ...(profile.baseUrl !== undefined ? { base_url: profile.baseUrl } : {}),
      ...(profile.secretRef !== undefined ? { api_key_secret_ref: profile.secretRef } : {}),
    },
    mcp_servers: [
      {
        name: "sphere",
        transport: gateway.endpoint,
        auth_secret_ref: gateway.authSecretRef,
        allowed_tools: gateway.allowedTools,
        enabled: true,
      },
    ],
    native_tools: { allow: projection.nativeToolsAllow },
    autonomous_mcp_install: false,
  };
}

/** Minimal YAML serializer for the fixed HermesConfig shape. */
export function toYaml(config: HermesConfig): string {
  const lines: string[] = [];
  const scalar = (v: string | boolean): string => (typeof v === "boolean" ? String(v) : quoteIfNeeded(v));

  lines.push("runtime:");
  for (const [k, v] of Object.entries(config.runtime)) {
    if (v !== undefined) lines.push(`  ${k}: ${scalar(v as string)}`);
  }

  lines.push("mcp_servers:");
  for (const s of config.mcp_servers) {
    lines.push(`  - name: ${scalar(s.name)}`);
    lines.push(`    transport: ${scalar(s.transport)}`);
    lines.push(`    auth_secret_ref: ${scalar(s.auth_secret_ref)}`);
    lines.push(`    enabled: ${s.enabled}`);
    lines.push("    allowed_tools:");
    for (const t of s.allowed_tools) lines.push(`      - ${scalar(t)}`);
  }

  lines.push("native_tools:");
  lines.push("  allow:");
  for (const t of config.native_tools.allow) lines.push(`    - ${scalar(t)}`);

  lines.push(`autonomous_mcp_install: ${config.autonomous_mcp_install}`);

  return lines.join("\n") + "\n";
}

function quoteIfNeeded(v: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(v) ? v : JSON.stringify(v);
}

/** Filesystem port (injectable for tests). */
export interface HermesFsPort {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface WriteHermesProfileOptions {
  /** Hermes home root, e.g. "/home/hermes/.hermes". */
  readonly home: string;
  readonly fs: HermesFsPort;
}

/**
 * Write the projected config into the agent's Hermes profile directory. Returns
 * the config file path. KinOS owns this file; the agent never edits it.
 */
export async function writeHermesProfile(
  projection: RuntimeConfigProjection,
  options: WriteHermesProfileOptions,
): Promise<string> {
  const dir = `${options.home.replace(/\/+$/, "")}/${projection.agentId}`;
  const path = `${dir}/config.yaml`;
  await options.fs.mkdir(dir);
  await options.fs.writeFile(path, toYaml(projectionToHermesConfig(projection)));
  return path;
}
