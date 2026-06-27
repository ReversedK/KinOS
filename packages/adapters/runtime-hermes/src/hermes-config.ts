/**
 * Hermes configuration projection writer (RFC-007).
 *
 * Realizes the provider-agnostic RuntimeConfigProjection (domain core) as a
 * Hermes profile: one `~/.hermes/<profile>/config.yaml` (+ `.env`) per principal,
 * owned by KinOS. The agent never edits these files. Consequences carried from
 * the domain projection (the core already enforced them; this only serializes):
 *   - exactly one MCP server, the Sphere MCP, with its tools.include surface;
 *   - native tools are a deny-by-default allow-list;
 *   - autonomous MCP install is disabled (KinOS registers only the Sphere MCP).
 *
 * Real Hermes config schema (verified against
 * hermes-agent.nousresearch.com/docs/user-guide/features/mcp and
 * cli-config.yaml.example):
 *   - `model:` { default, provider, base_url?, api_key? }
 *   - `mcp_servers:` is a MAP keyed by server name, each { url, headers, tools,
 *     enabled }; an HTTP server authenticates via `headers.Authorization`.
 *
 * Secret handling (ADR-007 / secret-store.md): config.yaml stays secret-free —
 * the Authorization header references an env var (`${SPHERE_MCP_TOKEN}`) and the
 * actual token value is written only to the profile `.env`, the single place the
 * value lands. NOTE: this relies on Hermes interpolating `${VAR}` from `.env`
 * into config header values — to confirm against a running Hermes container
 * (env-var interpolation is the one piece not verifiable from the docs alone).
 */

import type { RuntimeConfigProjection } from "@kinos/core";

/** Env var (resolved from the profile `.env`) holding the Sphere MCP token. */
export const SPHERE_MCP_TOKEN_ENV = "SPHERE_MCP_TOKEN";

export interface HermesMcpServer {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly tools: { readonly include: readonly string[] };
  readonly enabled: true;
}

export interface HermesConfig {
  readonly model: {
    readonly default: string;
    readonly provider: string;
    readonly base_url?: string;
    readonly api_key?: string;
  };
  /** Map keyed by server name — KinOS registers exactly one: "sphere". */
  readonly mcp_servers: Readonly<Record<string, HermesMcpServer>>;
  readonly native_tools: { readonly allow: readonly string[] };
  readonly autonomous_mcp_install: false;
}

/** Pure mapping: a domain projection -> the (real-schema) Hermes config object. */
export function projectionToHermesConfig(projection: RuntimeConfigProjection): HermesConfig {
  const { profile, gateway } = projection;
  return {
    model: {
      default: profile.model,
      provider: profile.providerId,
      ...(profile.baseUrl !== undefined ? { base_url: profile.baseUrl } : {}),
      // Provider key (cloud) referenced via env, never inlined (secret-store.md).
      ...(profile.secretRef !== undefined ? { api_key: `\${${providerKeyEnv(profile.providerId)}}` } : {}),
    },
    mcp_servers: {
      sphere: {
        url: gateway.endpoint,
        // Token by reference: the value lives in the profile `.env` (ADR-007).
        headers: { Authorization: `Bearer \${${SPHERE_MCP_TOKEN_ENV}}` },
        tools: { include: gateway.allowedTools },
        enabled: true,
      },
    },
    native_tools: { allow: projection.nativeToolsAllow },
    autonomous_mcp_install: false,
  };
}

function providerKeyEnv(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

/** Minimal YAML serializer for the fixed HermesConfig shape. */
export function toYaml(config: HermesConfig): string {
  const lines: string[] = [];
  const scalar = (v: string | boolean): string => (typeof v === "boolean" ? String(v) : quoteIfNeeded(v));

  lines.push("model:");
  for (const [k, v] of Object.entries(config.model)) {
    if (v !== undefined) lines.push(`  ${k}: ${scalar(v as string)}`);
  }

  lines.push("mcp_servers:");
  for (const [name, s] of Object.entries(config.mcp_servers)) {
    lines.push(`  ${scalar(name)}:`);
    lines.push(`    url: ${scalar(s.url)}`);
    lines.push(`    enabled: ${s.enabled}`);
    lines.push("    headers:");
    for (const [hk, hv] of Object.entries(s.headers)) lines.push(`      ${scalar(hk)}: ${scalar(hv)}`);
    lines.push("    tools:");
    lines.push("      include:");
    for (const t of s.tools.include) lines.push(`        - ${scalar(t)}`);
  }

  lines.push("native_tools:");
  lines.push("  allow:");
  for (const t of config.native_tools.allow) lines.push(`    - ${scalar(t)}`);

  lines.push(`autonomous_mcp_install: ${config.autonomous_mcp_install}`);

  return lines.join("\n") + "\n";
}

/** Serialize the profile `.env` — the single place the token value lands (ADR-007). */
export function toEnvFile(entries: Readonly<Record<string, string>>): string {
  return (
    Object.entries(entries)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

function quoteIfNeeded(v: string): string {
  // ${...} must be quoted so YAML treats it as a string, not a flow mapping.
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
  /**
   * The Sphere MCP token value to write to the profile `.env` (ADR-007: the one
   * place the value lands). Omit for a preview/dry-run — then no `.env` is
   * written and config.yaml still references the env var.
   */
  readonly token?: string;
}

/**
 * Write the projected config (+ `.env` when a token is supplied) into the agent's
 * Hermes profile directory. Returns the config file path. KinOS owns these files;
 * the agent never edits them.
 */
export async function writeHermesProfile(
  projection: RuntimeConfigProjection,
  options: WriteHermesProfileOptions,
): Promise<string> {
  const dir = `${options.home.replace(/\/+$/, "")}/${projection.agentId}`;
  const path = `${dir}/config.yaml`;
  await options.fs.mkdir(dir);
  await options.fs.writeFile(path, toYaml(projectionToHermesConfig(projection)));
  if (options.token !== undefined) {
    await options.fs.writeFile(`${dir}/.env`, toEnvFile({ [SPHERE_MCP_TOKEN_ENV]: options.token }));
  }
  return path;
}
