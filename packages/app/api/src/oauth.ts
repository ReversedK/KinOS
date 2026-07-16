/**
 * OAuth auth broker + pending-connection store (RFC-017).
 *
 * KinOS delegates the OAuth consent flow and token storage to a pluggable
 * `AuthBroker` (Better Auth is the reference implementation). KinOS never holds a
 * token: an integration's `secretRef` becomes a broker **account reference**, and a
 * provider adapter fetches a fresh token per call via `getAccessToken`.
 *
 * The broker lives in the app layer only; the domain core imports none of it.
 */

/** The OAuth mechanics KinOS needs, abstracted from any provider/library. */
export interface AuthBroker {
  /** Build the provider's authorize URL for a consent redirect. */
  authorizeUrl(input: { provider: string; scopes: readonly string[]; state: string; redirectUri: string }): Promise<string>;
  /** Exchange a callback code for a stored account; returns a reference, never a token. */
  exchange(input: { provider: string; code: string; state: string; redirectUri: string }): Promise<{ accountRef: string }>;
  /** Fetch a fresh access token for a connected account (auto-refreshed by the broker). */
  getAccessToken(accountRef: string): Promise<string>;
}

/**
 * A transient pending OAuth connection minted at `integration.oauth.begin` and
 * consumed at the callback. Single-use `state` (CSRF), short-lived. In-memory by
 * design: nothing durable is lost on restart (an in-flight consent just restarts).
 */
export interface PendingOAuth {
  readonly state: string;
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
    this.pending.set(p.state, p);
  }

  /** Redeem a state once. Undefined for unknown/expired/replayed — caller refuses. */
  redeem(state: string): PendingOAuth | undefined {
    const p = this.pending.get(state);
    if (p === undefined) return undefined;
    this.pending.delete(state); // single use
    if (Date.parse(p.expiresAt) <= Date.parse(this.now())) return undefined;
    return p;
  }

  prune(): void {
    const now = Date.parse(this.now());
    for (const [state, p] of this.pending) {
      if (Date.parse(p.expiresAt) <= now) this.pending.delete(state);
    }
  }
}

/**
 * A deterministic broker for tests and local dev without real OAuth credentials.
 * It fabricates an authorize URL, an account reference, and a token — enough to
 * exercise the governed flow end to end. Real deployments use the Better Auth
 * broker with real client credentials.
 */
export class FakeAuthBroker implements AuthBroker {
  private readonly tokens = new Map<string, string>();

  async authorizeUrl(input: { provider: string; scopes: readonly string[]; state: string; redirectUri: string }): Promise<string> {
    const u = new URL(`https://oauth.example/${encodeURIComponent(input.provider)}/authorize`);
    u.searchParams.set("scope", input.scopes.join(" "));
    u.searchParams.set("state", input.state);
    u.searchParams.set("redirect_uri", input.redirectUri);
    return u.toString();
  }

  async exchange(input: { provider: string; code: string; state: string; redirectUri: string }): Promise<{ accountRef: string }> {
    const accountRef = `broker://${input.provider}/${input.state}`;
    this.tokens.set(accountRef, `tok_${input.provider}_${input.code}`);
    return { accountRef };
  }

  async getAccessToken(accountRef: string): Promise<string> {
    const token = this.tokens.get(accountRef);
    if (token === undefined) throw new Error(`No connected account for ${accountRef}`);
    return token;
  }
}
