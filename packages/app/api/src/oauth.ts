/**
 * OAuth auth broker + pending-connection store (RFC-017/018).
 *
 * KinOS delegates the OAuth consent flow and token storage to a pluggable
 * `AuthBroker` (Better Auth is the reference — see better-auth-broker.ts). Better
 * Auth *owns* the provider callback and stores accounts/tokens, so the port is
 * shaped to that model (RFC-018): `beginConnect` returns the authorize URL, the
 * broker's own mounted handler processes the provider redirect, and
 * `resolveConnection` reads the resulting session to identify the connected
 * account. KinOS never holds a token — an integration's `secretRef` becomes a
 * broker **account reference**, and a provider adapter fetches a fresh token per
 * call via `getAccessToken`.
 *
 * The broker lives in the app layer only; the domain core imports none of it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** The OAuth mechanics KinOS needs, abstracted from any provider/library. */
export interface AuthBroker {
  /**
   * Begin connecting: returns the provider's authorize URL. `callbackURL` is where
   * the broker sends the browser after it has processed the provider redirect and
   * stored the account (KinOS's `/oauth/connected` page).
   */
  beginConnect(input: { provider: string; scopes: readonly string[]; callbackURL: string }): Promise<{ url: string }>;
  /**
   * After the browser returns to the callback URL, identify the connected account
   * from the request (the broker's session cookie). Undefined if no session —
   * refuse. Returns a reference to the broker-held account, never a token.
   */
  resolveConnection(input: { headers: Readonly<Record<string, string | undefined>> }): Promise<{ accountRef: string } | undefined>;
  /** Fetch a fresh access token for a connected account (auto-refreshed by the broker). */
  getAccessToken(accountRef: string): Promise<string>;
  /** A Node handler the broker needs mounted (Better Auth's /api/auth/*); absent for the fake. */
  readonly nodeHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  /** Where nodeHandler is mounted (e.g. "/api/auth"). */
  readonly basePath?: string;
}

/**
 * A transient pending connection minted at `integration.oauth.begin` and consumed
 * at `/oauth/connected`. A single-use `nonce` binds the browser round-trip back to
 * the right Sphere integration (broker-agnostic CSRF + binding). In-memory: nothing
 * durable is lost on restart (an in-flight consent just restarts).
 */
export interface PendingOAuth {
  readonly nonce: string;
  readonly sphereId: string;
  readonly integrationId: string;
  readonly provider: string;
  readonly expiresAt: string;
}

export const OAUTH_STATE_TTL_SECONDS = 600;

export class PendingOAuthStore {
  private readonly pending = new Map<string, PendingOAuth>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  issue(p: PendingOAuth): void {
    this.pending.set(p.nonce, p);
  }

  /** Redeem a nonce once. Undefined for unknown/expired/replayed — caller refuses. */
  redeem(nonce: string): PendingOAuth | undefined {
    const p = this.pending.get(nonce);
    if (p === undefined) return undefined;
    this.pending.delete(nonce); // single use
    if (Date.parse(p.expiresAt) <= Date.parse(this.now())) return undefined;
    return p;
  }

  prune(): void {
    const now = Date.parse(this.now());
    for (const [nonce, p] of this.pending) {
      if (Date.parse(p.expiresAt) <= now) this.pending.delete(nonce);
    }
  }
}

/**
 * A deterministic broker for tests and local dev without real OAuth credentials.
 * `beginConnect` returns the callback URL directly (the "provider" immediately
 * approves), `resolveConnection` fabricates an account, and `getAccessToken`
 * returns a stable token — enough to exercise the governed flow end to end.
 */
export class FakeAuthBroker implements AuthBroker {
  async beginConnect(input: { provider: string; scopes: readonly string[]; callbackURL: string }): Promise<{ url: string }> {
    const sep = input.callbackURL.includes("?") ? "&" : "?";
    return { url: `${input.callbackURL}${sep}fake_provider=${encodeURIComponent(input.provider)}` };
  }

  async resolveConnection(input: { headers: Readonly<Record<string, string | undefined>> }): Promise<{ accountRef: string } | undefined> {
    const user = input.headers["x-fake-user"] ?? "u1";
    return { accountRef: `broker://fake/${user}` };
  }

  async getAccessToken(accountRef: string): Promise<string> {
    return `tok_${accountRef.split("/").pop() ?? "x"}`;
  }
}
