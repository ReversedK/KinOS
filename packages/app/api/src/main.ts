/**
 * KinOS read API server entrypoint.
 *
 * Wires the router to the durable SQLite stores and listens on $KINOS_API_PORT
 * (default 8787). Reads expose already-governed state; the governed write path
 * (capability execution) runs the core pipeline through a local executor.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { RUNTIME_GOVERNANCE_TOOLS, type AgentRuntime } from "@kinos/core";
import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";
import {
  SqliteAgentTokenStore,
  SqliteApprovalStore,
  SqliteAuditSink,
  SqliteSessionStore,
  SqliteSphereStore,
} from "@kinos/persistence-sqlite";
import type { HermesFsPort } from "@kinos/runtime-hermes";
import { OllamaRuntime } from "@kinos/runtime-ollama";
import { OpenAiRuntime } from "@kinos/runtime-openai";

import { createApiServer } from "./server.js";
import { projectAgentConfig, type RuntimeGovernanceDeps, type RuntimeProjectInput } from "./runtime-governance.js";

/**
 * Select the agent runtime. A "boring" swap (coding principle 9): changing the
 * runtime needs no policy, memory or capability migration. Hermes is opt-in via
 * KINOS_RUNTIME=hermes; the default stays local-first Ollama so dev without a
 * Hermes container keeps working.
 *
 * Hermes exposes an OpenAI-compatible API server (`/v1/chat/completions`,
 * `/v1/models`, Bearer-authenticated by API_SERVER_KEY — verified against the
 * NousResearch/hermes-agent image), so Hermes-as-inference reuses the OpenAI
 * adapter pointed at it. There is no bespoke Hermes runtime. The request `model`
 * selects the Hermes profile (one profile per agent); set the Sphere's model
 * (RFC-004) to the target profile name.
 */
function selectRuntime(): AgentRuntime {
  if ((process.env["KINOS_RUNTIME"] ?? "ollama").toLowerCase() === "hermes") {
    return new OpenAiRuntime({
      baseUrl: process.env["HERMES_BASE_URL"] ?? "http://localhost:8642/v1",
      apiKey: process.env["HERMES_API_KEY"] ?? "",
    });
  }
  return new OllamaRuntime();
}

function ensureDir(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

const store = new SqliteSphereStore(ensureDir(process.env["KINOS_DB"] ?? "data/kinos.sqlite"));
const approvals = new SqliteApprovalStore(ensureDir(process.env["KINOS_APPROVALS_DB"] ?? "data/approvals.sqlite"));
const audit = new SqliteAuditSink(ensureDir(process.env["KINOS_AUDIT_DB"] ?? "data/audit.sqlite"));
const sessions = new SqliteSessionStore(ensureDir(process.env["KINOS_SESSIONS_DB"] ?? "data/sessions.sqlite"));
const tokens = new SqliteAgentTokenStore(ensureDir(process.env["KINOS_TOKENS_DB"] ?? "data/tokens.sqlite"));

// Runtime-governance executor deps (RFC-007/ADR-007). Writes each agent's
// runtime profile under the Hermes home and provisions its Sphere-MCP token.
const nodeFs: HermesFsPort = {
  mkdir: async (p) => {
    await mkdir(p, { recursive: true });
  },
  writeFile: async (p, c) => {
    await writeFile(p, c);
  },
};
const mcpPublicUrl = (process.env["KINOS_PUBLIC_URL"] ?? `http://localhost:${process.env["KINOS_API_PORT"] ?? "8787"}`).replace(/\/+$/, "");
const govDeps: RuntimeGovernanceDeps = {
  store,
  tokens,
  home: process.env["HERMES_HOME"] ?? "data/hermes",
  fs: nodeFs,
  gatewayEndpoint: (sphereId) => `${mcpPublicUrl}/spheres/${encodeURIComponent(sphereId)}/mcp`,
  auditSink: audit,
};

// Local executor for the governed write path (mirrors the CLI's handler set),
// plus the runtime-governance tools (RFC-007): runtime.config.project writes the
// agent's profile + provisions its token. backup/restore are not yet wired.
const executor = new LocalCapabilityExecutor(
  new Map<string, CapabilityHandler>([
    ["local.calendar", async (input) => ({ created: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
    [RUNTIME_GOVERNANCE_TOOLS["runtime.config.project"], async (input) => projectAgentConfig(govDeps, input as RuntimeProjectInput)],
  ]),
);

const port = Number(process.env["KINOS_API_PORT"] ?? "8787");
const server = createApiServer(
  {
    store,
    approvals,
    audit,
    auditSink: audit,
    executor,
    sessions,
    runtime: selectRuntime(),
    newCorrelationId: () => randomUUID(),
    newApprovalId: () => `apr_${randomUUID()}`,
    newSessionId: () => `ses_${randomUUID()}`,
  },
  // Sphere MCP gateway (RFC-007, ADR-007): the governed tool surface Hermes calls.
  {
    store,
    tokens,
    executor,
    auditSink: audit,
    approvals,
    newApprovalId: () => `apr_${randomUUID()}`,
    newCorrelationId: () => randomUUID(),
  },
);
server.listen(port, () => console.log(`KinOS API listening on :${port}`));
