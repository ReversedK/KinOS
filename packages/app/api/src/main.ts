/**
 * KinOS read API server entrypoint.
 *
 * Wires the router to the durable SQLite stores and listens on $KINOS_API_PORT
 * (default 8787). Read-only: it exposes already-governed state; governed writes
 * go through the core pipeline (CLI today).
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { SqliteApprovalStore, SqliteAuditSink, SqliteSphereStore } from "@kinos/persistence-sqlite";

import { createApiServer } from "./server.js";

function ensureDir(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

const store = new SqliteSphereStore(ensureDir(process.env["KINOS_DB"] ?? "data/kinos.sqlite"));
const approvals = new SqliteApprovalStore(ensureDir(process.env["KINOS_APPROVALS_DB"] ?? "data/approvals.sqlite"));
const audit = new SqliteAuditSink(ensureDir(process.env["KINOS_AUDIT_DB"] ?? "data/audit.sqlite"));

const port = Number(process.env["KINOS_API_PORT"] ?? "8787");
const server = createApiServer({ store, approvals, audit, newCorrelationId: () => randomUUID() });
server.listen(port, () => console.log(`KinOS read API listening on :${port}`));
