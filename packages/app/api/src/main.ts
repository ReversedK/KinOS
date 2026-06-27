/**
 * KinOS read API server entrypoint.
 *
 * Wires the router to the durable SQLite stores and listens on $KINOS_API_PORT
 * (default 8787). Reads expose already-governed state; the governed write path
 * (capability execution) runs the core pipeline through a local executor.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { AgentRuntime } from "@kinos/core";
import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";
import {
  SqliteAgentTokenStore,
  SqliteApprovalStore,
  SqliteAuditSink,
  SqliteSessionStore,
  SqliteSphereStore,
} from "@kinos/persistence-sqlite";
import { OllamaRuntime } from "@kinos/runtime-ollama";
import { OpenAiRuntime } from "@kinos/runtime-openai";

import { createApiServer } from "./server.js";

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

// Local executor for the governed write path (mirrors the CLI's handler set).
const executor = new LocalCapabilityExecutor(
  new Map<string, CapabilityHandler>([
    ["local.calendar", async (input) => ({ created: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
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
