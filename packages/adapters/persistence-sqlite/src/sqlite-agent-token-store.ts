/**
 * Durable SQLite agent-token store (ADR-007).
 *
 * The secret-store realization of the per-agent Sphere-MCP token. It mints a
 * high-entropy token, returns the raw value **once**, and persists only a
 * SHA-256 hash plus a stable `secretRef` and status. The plaintext token is
 * never stored (it lives only here-transiently-returned and, in production, in
 * the agent's KinOS-owned runtime profile `.env`). Resolution hashes the
 * presented token and matches an `active` row — fail-closed for unknown, revoked
 * or rotating-out tokens.
 *
 * `secretRef` is derived deterministically from sphere+agent so it is stable
 * across rotation (secret-store.md: rotation never changes the ref).
 */

import { createHash, randomBytes } from "node:crypto";

import Database from "better-sqlite3";
import type { AgentTokenRecord, AgentTokenStore, ProvisionedToken, ResolvedToken } from "@kinos/core";

interface TokenRow {
  readonly sphere_id: string;
  readonly agent_id: string;
  readonly secret_ref: string;
  readonly status: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secretRefFor(sphereId: string, agentId: string): string {
  return `secret://sphere-mcp/${sphereId}/${agentId}`;
}

export class SqliteAgentTokenStore implements AgentTokenStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS agent_tokens (
         sphere_id TEXT NOT NULL,
         agent_id TEXT NOT NULL,
         token_hash TEXT NOT NULL,
         secret_ref TEXT NOT NULL,
         status TEXT NOT NULL,
         PRIMARY KEY (sphere_id, agent_id)
       )`,
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens (token_hash)");
  }

  async provision(sphereId: string, agentId: string): Promise<ProvisionedToken> {
    return this.mint(sphereId, agentId);
  }

  async rotate(sphereId: string, agentId: string): Promise<ProvisionedToken> {
    // Stable secretRef across rotation; the value (and its hash) is replaced.
    return this.mint(sphereId, agentId);
  }

  async revoke(sphereId: string, agentId: string): Promise<void> {
    this.db
      .prepare("UPDATE agent_tokens SET status = 'revoked' WHERE sphere_id = ? AND agent_id = ?")
      .run(sphereId, agentId);
  }

  resolve(token: string): ResolvedToken | undefined {
    if (token.trim() === "") return undefined;
    const row = this.db
      .prepare("SELECT sphere_id, agent_id, secret_ref, status FROM agent_tokens WHERE token_hash = ? AND status = 'active'")
      .get(hashToken(token)) as TokenRow | undefined;
    if (row === undefined) return undefined;
    return { sphereId: row.sphere_id, agentId: row.agent_id, secretRef: row.secret_ref };
  }

  private mint(sphereId: string, agentId: string): ProvisionedToken {
    const token = randomBytes(32).toString("base64url");
    const secretRef = secretRefFor(sphereId, agentId);
    this.db
      .prepare(
        `INSERT INTO agent_tokens (sphere_id, agent_id, token_hash, secret_ref, status)
         VALUES (?, ?, ?, ?, 'active')
         ON CONFLICT (sphere_id, agent_id)
         DO UPDATE SET token_hash = excluded.token_hash, secret_ref = excluded.secret_ref, status = 'active'`,
      )
      .run(sphereId, agentId, hashToken(token), secretRef);
    const record: AgentTokenRecord = { secretRef, sphereId, agentId, status: "active" };
    return { record, token };
  }

  close(): void {
    this.db.close();
  }
}
