/**
 * Hermes configuration projection writer (RFC-007).
 *
 * Realizes the provider-agnostic RuntimeConfigProjection (domain core) as a
 * Hermes profile: one `~/.hermes/<profile>/config.yaml` (+ `.env`) per principal,
 * owned by KinOS. The agent never edits these files. Consequences carried from
 * the domain projection (the core already enforced them; this only serializes):
 *   - exactly one MCP server, the Sphere MCP, with its tools.include surface;
 *   - native toolsets are governed via Hermes' real `agent.enabled_toolsets` /
 *     `agent.disabled_toolsets` keys (RFC-025), deny-by-default: only granted
 *     toolsets are enabled, and every ungranted toolset — always including native
 *     memory, terminal, file and code execution — is explicitly disabled;
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

/**
 * Hermes refuses a context window below 64K, and Ollama frequently reports a
 * smaller window than the model's real one — so the projected profile must state
 * one explicitly or Hermes rejects the config. This is a Hermes-specific
 * requirement and stays in the adapter: the domain's RuntimeProfile (RFC-004)
 * describes provider/model, not a runtime's config minimums (coding principle 1).
 */
export const HERMES_MIN_CONTEXT_LENGTH = 65536;

/**
 * Hermes' known native toolsets (RFC-025). KinOS governs at this grain via the real
 * `agent.enabled_toolsets` / `agent.disabled_toolsets` keys. Deny-by-default is made
 * robust by explicitly DISABLING every toolset that is not granted, rather than
 * trusting an empty allow-list — so the outcome does not depend on Hermes' own
 * defaults. The dangerous toolsets (`terminal`, `file`, `execute_code`), native
 * `memory` (invariant 2 — canonical memory is served via the Sphere MCP instead)
 * and `agent`/delegate are never grantable, so they are always in the disabled set.
 */
export const ALL_HERMES_TOOLSETS = [
  "web",
  "x",
  "browser",
  "media",
  "cron",
  "memory",
  "terminal",
  "file",
  "execute_code",
  "agent",
] as const;

/**
 * Hermes' `ollama` provider speaks the OpenAI-compatible endpoint: a bare
 * `:11434` base_url 404s, so the `/v1` suffix is required. Applied only to a
 * local Ollama base URL the operator supplied without it — a deployment detail of
 * talking to Ollama, not a domain rule.
 */
function normalizeBaseUrl(providerId: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return providerId === "ollama" && !/\/v\d+$/.test(trimmed) ? `${trimmed}/v1` : trimmed;
}

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
    readonly context_length: number;
  };
  /** Map keyed by server name — KinOS registers exactly one: "sphere". */
  readonly mcp_servers: Readonly<Record<string, HermesMcpServer>>;
  /** Real Hermes toolset governance (RFC-025): granted toolsets enabled, all else disabled. */
  readonly agent: {
    readonly enabled_toolsets: readonly string[];
    readonly disabled_toolsets: readonly string[];
  };
  readonly autonomous_mcp_install: false;
}

/** Pure mapping: a domain projection -> the (real-schema) Hermes config object. */
export function projectionToHermesConfig(projection: RuntimeConfigProjection): HermesConfig {
  const { profile, gateway } = projection;
  return {
    // The governed provider/model (RFC-004/009) becomes the profile's model block:
    // Hermes runs the agent on exactly what KinOS decided, never a Hermes-local
    // default (ADR-008 §4).
    model: {
      default: profile.model,
      provider: profile.providerId,
      ...(profile.baseUrl !== undefined
        ? { base_url: normalizeBaseUrl(profile.providerId, profile.baseUrl) }
        : {}),
      // Provider key (cloud) referenced via env, never inlined (secret-store.md).
      ...(profile.secretRef !== undefined ? { api_key: `\${${providerKeyEnv(profile.providerId)}}` } : {}),
      context_length: HERMES_MIN_CONTEXT_LENGTH,
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
    agent: toolsetGovernance(projection.nativeToolsetsAllow),
    autonomous_mcp_install: false,
  };
}

/**
 * Deny-by-default toolset governance: enable exactly the granted toolsets, and
 * explicitly disable every other known toolset (so the result never depends on
 * Hermes' defaults). The hard floor (memory/terminal/file/execute_code/agent) is
 * never granted, so it is always disabled.
 */
export function toolsetGovernance(granted: readonly string[]): {
  enabled_toolsets: readonly string[];
  disabled_toolsets: readonly string[];
} {
  const enabledSet = new Set(granted);
  return {
    enabled_toolsets: [...granted],
    disabled_toolsets: ALL_HERMES_TOOLSETS.filter((t) => !enabledSet.has(t)),
  };
}

function providerKeyEnv(provider: string): string {
  return `${provider.toUpperCase()}_API_KEY`;
}

export function hermesProfileDir(home: string, profileName: string): string {
  return `${home.replace(/\/+$/, "")}/profiles/${profileName}`;
}

/** Minimal YAML serializer for the fixed HermesConfig shape. */
export function toYaml(config: HermesConfig): string {
  const lines: string[] = [];
  const scalar = (v: string | number | boolean): string =>
    typeof v === "string" ? quoteIfNeeded(v) : String(v);

  lines.push("model:");
  for (const [k, v] of Object.entries(config.model)) {
    if (v !== undefined) lines.push(`  ${k}: ${scalar(v as string | number)}`);
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

  lines.push("agent:");
  lines.push("  enabled_toolsets:");
  for (const t of config.agent.enabled_toolsets) lines.push(`    - ${scalar(t)}`);
  lines.push("  disabled_toolsets:");
  for (const t of config.agent.disabled_toolsets) lines.push(`    - ${scalar(t)}`);

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

function replaceTopLevelBlock(src: string, key: string, block: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  let replaced = false;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith(`${key}:`)) {
      if (!replaced) out.push(...block.split("\n"));
      replaced = true;
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.length === 0) {
          i += 1;
          continue;
        }
        if (/^[^ \t#]/.test(next)) break;
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }

  if (!replaced) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(...block.split("\n"));
  }

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

export function mergeHermesConfig(existing: string | undefined, projection: RuntimeConfigProjection): string {
  const cfg = projectionToHermesConfig(projection);
  let merged = existing?.trim().length ? existing : "";
  merged = replaceTopLevelBlock(
    merged,
    "model",
    [
      "model:",
      ...Object.entries(cfg.model).flatMap(([k, v]) =>
        v !== undefined ? [`  ${k}: ${typeof v === "string" ? quoteIfNeeded(v) : String(v)}`] : [],
      ),
    ].join("\n"),
  );
  merged = replaceTopLevelBlock(
    merged,
    "mcp_servers",
    [
      "mcp_servers:",
      ...Object.entries(cfg.mcp_servers).flatMap(([name, s]) => [
        `  ${quoteIfNeeded(name)}:`,
        `    url: ${quoteIfNeeded(s.url)}`,
        `    enabled: ${s.enabled}`,
        "    headers:",
        ...Object.entries(s.headers).map(([hk, hv]) => `      ${quoteIfNeeded(hk)}: ${quoteIfNeeded(hv)}`),
        "    tools:",
        "      include:",
        ...s.tools.include.map((t) => `        - ${quoteIfNeeded(t)}`),
      ]),
    ].join("\n"),
  );
  merged = replaceTopLevelBlock(
    merged,
    "agent",
    [
      "agent:",
      "  enabled_toolsets:",
      ...cfg.agent.enabled_toolsets.map((t) => `    - ${quoteIfNeeded(t)}`),
      "  disabled_toolsets:",
      ...cfg.agent.disabled_toolsets.map((t) => `    - ${quoteIfNeeded(t)}`),
    ].join("\n"),
  );
  merged = replaceTopLevelBlock(merged, "autonomous_mcp_install", `autonomous_mcp_install: ${cfg.autonomous_mcp_install}`);
  return merged;
}

function parseEnvFile(src: string | undefined): Map<string, string> {
  const entries = new Map<string, string>();
  if (src === undefined) return entries;
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    entries.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return entries;
}

export function mergeHermesEnv(existing: string | undefined, entries: Readonly<Record<string, string>>): string {
  const merged = parseEnvFile(existing);
  for (const [k, v] of Object.entries(entries)) merged.set(k, v);
  return toEnvFile(Object.fromEntries(merged));
}

/** Filesystem port (injectable for tests). */
export interface HermesFsPort {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string | undefined>;
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
  const dir = hermesProfileDir(options.home, projection.agentId);
  const path = `${dir}/config.yaml`;
  const envPath = `${dir}/.env`;
  await options.fs.mkdir(dir);
  const currentConfig = await options.fs.readFile(path);
  await options.fs.writeFile(path, mergeHermesConfig(currentConfig, projection));
  if (options.token !== undefined) {
    const currentEnv = await options.fs.readFile(envPath);
    await options.fs.writeFile(envPath, mergeHermesEnv(currentEnv, { [SPHERE_MCP_TOKEN_ENV]: options.token }));
  }
  return path;
}
