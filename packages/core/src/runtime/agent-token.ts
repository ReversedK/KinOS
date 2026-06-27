/**
 * Per-agent Sphere-MCP token directory (ADR-007).
 *
 * The secret-store realization for the `agent-runtime` SecretOwner kind: each
 * agent (runtime profile) holds one Sphere-MCP access token that *authenticates*
 * it to the Sphere MCP. The token carries no authority of its own — authorization
 * stays the Policy Engine's per-call decision, anchored to the resolved identity.
 *
 * This is a pure domain **port**. The value never enters the domain: an
 * implementation mints a high-entropy token, returns the raw value **once** for
 * the caller to place in the agent's runtime profile, and persists only a one-way
 * hash plus a stable `secretRef`. Resolution is fail-closed: an unknown, revoked
 * or wrong-Sphere token resolves to nothing. Crypto, hashing and persistence live
 * in adapters (coding principle 1).
 */

export type AgentTokenStatus = "active" | "rotating" | "revoked";

export interface AgentTokenRecord {
  /** Stable secret-store reference; unchanged across rotation (secret-store.md). */
  readonly secretRef: string;
  readonly sphereId: string;
  readonly agentId: string;
  readonly status: AgentTokenStatus;
}

export interface ProvisionedToken {
  readonly record: AgentTokenRecord;
  /** Raw token value — returned ONCE at mint/rotate; never persisted in clear. */
  readonly token: string;
}

/** Maps a presented token back to its owning Sphere/agent (no identity claim). */
export interface ResolvedToken {
  readonly sphereId: string;
  readonly agentId: string;
  readonly secretRef: string;
}

export interface AgentTokenStore {
  /** Mint (or replace) the agent's token; returns the raw value once. */
  provision(sphereId: string, agentId: string): Promise<ProvisionedToken>;
  /** Rotate the value keeping the stable secretRef; returns the new raw value. */
  rotate(sphereId: string, agentId: string): Promise<ProvisionedToken>;
  /** Revoke: future resolution is denied; past audit facts remain. */
  revoke(sphereId: string, agentId: string): Promise<void>;
  /** Resolve a presented token to its owner, only while active (fail-closed). */
  resolve(token: string): ResolvedToken | undefined;
}
