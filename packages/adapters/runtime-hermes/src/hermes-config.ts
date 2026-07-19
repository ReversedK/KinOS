/**
 * Hermes configuration projection writer (RFC-007).
 *
 * Realizes the provider-agnostic RuntimeConfigProjection (domain core) as a
 * Hermes profile: one `~/.hermes/<profile>/config.yaml` (+ `.env`) per principal,
 * owned by KinOS. The agent never edits these files. Consequences carried from
 * the domain projection (the core already enforced them; this only serializes):
 *   - exactly one MCP server, the Sphere MCP, with its tools.include surface;
 *   - native toolsets are governed via Hermes' REAL keys (RFC-025, verified against
 *     the installed hermes_cli): the grant is the exclusive per-platform list
 *     `platform_toolsets.<gateway>` (NOT the unread `agent.enabled_toolsets`), and
 *     the hard floor — native memory, terminal, file, code execution, computer use,
 *     delegation — is always in the global `agent.disabled_toolsets` master subtraction;
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
 * value lands. VERIFIED against the live Hermes container: with `HERMES_HOME` set
 * to the profile dir (a Hermes profile IS a HERMES_HOME — what KinOS's bridge/gateway
 * sets), the startup `load_hermes_dotenv()` applies the profile `.env` into the
 * environment and `load_config()`'s `_expand_env_vars` resolves the header to
 * `Bearer <token>`. The interpolation seam is real, not fictional.
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
 * The gateway platform KinOS runs Hermes as (`hermes gateway run`). Toolsets are
 * granted PER PLATFORM under `platform_toolsets.<platform>` — NOT via a global
 * `agent.enabled_toolsets` (verified against the real Hermes: that key is not read;
 * only `agent.disabled_toolsets` is). The per-platform list is exclusive, so it is
 * itself deny-by-default: an agent gets only the toolsets listed here.
 */
export const HERMES_GATEWAY_PLATFORM = "api_server";

/**
 * Abstract KinOS grant token → real Hermes toolset name(s) (RFC-025). KinOS's
 * `native.<token>` capabilities are provider-agnostic; this adapter maps each to the
 * Harness's actual toolset keys (verified against the installed `toolsets` registry:
 * cron is `cronjob`, media bundles three, etc.).
 */
export const GRANT_TO_HERMES_TOOLSETS: Readonly<Record<string, readonly string[]>> = {
  web: ["web"],
  cron: ["cronjob"],
  media: ["vision", "image_gen", "tts"],
  browser: ["browser"],
  // RFC-030: subagents. Safe to grant — a child's toolsets are a subset of the
  // parent's governed set and its calls flow through the parent's Sphere MCP
  // (verified live against delegate_tool.py: child_toolsets ⊆ parent).
  delegate: ["delegation"],
};

/**
 * The hard floor: toolsets that are NEVER grantable. `memory` is here because
 * canonical memory is served via the Sphere MCP (invariant 2); the rest give
 * shell / code / file / full-computer power a governed family agent must never
 * hold. (Real Hermes toolset names — verified against the installed `toolsets`
 * registry: `code_execution`.)
 *
 * `delegation` is NOT on the floor (RFC-030): it is grantable via
 * `native.delegate`. A subagent's toolsets are a subset of the parent's governed
 * set and its capability calls still flow through the parent's Sphere MCP, so it
 * cannot exceed the parent's authority nor reach any floored toolset (those are
 * absent from the parent, hence from every child).
 */
export const HERMES_TOOLSET_FLOOR = [
  "memory",
  "terminal",
  "file",
  "code_execution",
  "computer_use",
] as const;

/**
 * Every configurable Hermes toolset (verified against the installed
 * CONFIGURABLE_TOOLSETS registry). Deny-by-default is enforced by disabling every
 * one of these that is NOT granted, via `agent.disabled_toolsets` — the master
 * subtraction Hermes applies last. This is required because an empty per-platform
 * grant list falls through to Hermes' (permissive) defaults; the subtraction clamps
 * the effective set to exactly the grant. Keep in sync with the Harness version.
 */
export const ALL_HERMES_CONFIGURABLE_TOOLSETS = [
  "browser", "clarify", "code_execution", "computer_use", "context_engine",
  "cronjob", "delegation", "discord", "discord_admin", "file",
  "homeassistant", "image_gen", "memory", "session_search", "skills",
  "spotify", "terminal", "todo", "tts", "video",
  "video_gen", "vision", "web", "x_search", "yuanbao",
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
  /**
   * Real Hermes toolset governance (RFC-025). The grant is the exclusive per-platform
   * list `platform_toolsets.<gateway>`; the floor is the global `agent.disabled_toolsets`
   * master subtraction. Together they deny-by-default and hard-floor the dangerous set.
   */
  readonly platform_toolsets: Readonly<Record<string, readonly string[]>>;
  readonly agent: { readonly disabled_toolsets: readonly string[] };
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
    ...toolsetGovernance(projection.nativeToolsetsAllow),
    autonomous_mcp_install: false,
  };
}

/**
 * Deny-by-default toolset governance (verified against the live Hermes resolver):
 *   - grant: the exclusive per-platform list `platform_toolsets.<gateway>`;
 *   - clamp: disable EVERY configurable toolset that is not granted, via the global
 *     `agent.disabled_toolsets` master subtraction — so an empty grant (which
 *     otherwise falls through to Hermes' permissive defaults) yields nothing, and
 *     the hard floor can never be reached.
 */
export function toolsetGovernance(grantTokens: readonly string[]): {
  platform_toolsets: Readonly<Record<string, readonly string[]>>;
  agent: { disabled_toolsets: readonly string[] };
} {
  const granted = grantedToolsets(grantTokens);
  const grantedSet = new Set(granted);
  return {
    platform_toolsets: { [HERMES_GATEWAY_PLATFORM]: granted },
    agent: { disabled_toolsets: ALL_HERMES_CONFIGURABLE_TOOLSETS.filter((t) => !grantedSet.has(t)) },
  };
}

/**
 * Map the abstract KinOS grant tokens (from `native.<token>` capabilities) to the
 * Harness's real toolset names, deduped and floor-stripped. The per-platform list
 * Hermes reads is exclusive, so this alone is deny-by-default; the floor cannot be
 * requested even if a grant token mistakenly resolved to one.
 */
export function grantedToolsets(grantTokens: readonly string[]): readonly string[] {
  const floor = new Set<string>(HERMES_TOOLSET_FLOOR);
  const out: string[] = [];
  for (const token of grantTokens) {
    for (const ts of GRANT_TO_HERMES_TOOLSETS[token] ?? []) {
      if (!floor.has(ts) && !out.includes(ts)) out.push(ts);
    }
  }
  return out;
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

  lines.push("platform_toolsets:");
  for (const [plat, list] of Object.entries(config.platform_toolsets)) {
    lines.push(`  ${scalar(plat)}:`);
    for (const t of list) lines.push(`    - ${scalar(t)}`);
  }

  lines.push("agent:");
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
    "platform_toolsets",
    [
      "platform_toolsets:",
      ...Object.entries(cfg.platform_toolsets).flatMap(([plat, list]) => [
        `  ${quoteIfNeeded(plat)}:`,
        ...list.map((t) => `    - ${quoteIfNeeded(t)}`),
      ]),
    ].join("\n"),
  );
  merged = replaceTopLevelBlock(
    merged,
    "agent",
    ["agent:", "  disabled_toolsets:", ...cfg.agent.disabled_toolsets.map((t) => `    - ${quoteIfNeeded(t)}`)].join("\n"),
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
