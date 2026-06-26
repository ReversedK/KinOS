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

import { LocalCapabilityExecutor, type CapabilityHandler } from "@kinos/executor-local";
import { SqliteApprovalStore, SqliteAuditSink, SqliteSphereStore } from "@kinos/persistence-sqlite";

import { createApiServer } from "./server.js";

function ensureDir(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

const store = new SqliteSphereStore(ensureDir(process.env["KINOS_DB"] ?? "data/kinos.sqlite"));
const approvals = new SqliteApprovalStore(ensureDir(process.env["KINOS_APPROVALS_DB"] ?? "data/approvals.sqlite"));
const audit = new SqliteAuditSink(ensureDir(process.env["KINOS_AUDIT_DB"] ?? "data/audit.sqlite"));

// Local executor for the governed write path (mirrors the CLI's handler set).
const executor = new LocalCapabilityExecutor(
  new Map<string, CapabilityHandler>([
    ["local.calendar", async (input) => ({ created: true, input })],
    ["local.pay", async (input) => ({ paid: true, input })],
    ["local.echo", async (input) => ({ echoed: input })],
  ]),
);

const port = Number(process.env["KINOS_API_PORT"] ?? "8787");
const server = createApiServer({
  store,
  approvals,
  audit,
  auditSink: audit,
  executor,
  newCorrelationId: () => randomUUID(),
  newApprovalId: () => `apr_${randomUUID()}`,
});
server.listen(port, () => console.log(`KinOS API listening on :${port}`));
