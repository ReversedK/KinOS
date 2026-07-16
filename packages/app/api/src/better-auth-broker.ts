/**
 * Better Auth broker (RFC-018) — the reference `AuthBroker` implementation.
 *
 * Better Auth runs the OAuth consent flow and stores accounts/tokens; KinOS holds
 * only a reference. Mapping to the port:
 *   - `beginConnect` → `auth.api.signInSocial({ provider, callbackURL, disableRedirect })`
 *     returns the provider authorize URL;
 *   - Better Auth's own handler (mounted at `/api/auth/*` via `nodeHandler`)
 *     processes the provider redirect (`/api/auth/callback/:provider`), stores the
 *     account + tokens, and redirects the browser to `callbackURL`;
 *   - `resolveConnection` reads the resulting session (cookie) and returns an
 *     account reference `provider::userId` — never a token;
 *   - `getAccessToken` → `auth.api.getAccessToken`, which auto-refreshes.
 *
 * Deployment: set BETTER_AUTH_SECRET, BETTER_AUTH_URL (the API's public base), and
 * the provider client credentials (GOOGLE_CLIENT_ID/SECRET, Apple keys). The
 * account store here is Better Auth's in-memory adapter (fine for a single-process
 * dev/reference deployment); a durable adapter (SQLite/Postgres) is a config swap.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

import type { AuthBroker } from "./oauth.js";

export interface BetterAuthBrokerOptions {
  readonly baseURL: string;
  readonly basePath?: string;
  readonly secret: string;
  readonly google?: { clientId: string; clientSecret: string };
  readonly apple?: { clientId: string; clientSecret: string };
}

const REF_SEP = "::";

/** Extracted so the instance field infers the concrete `Auth<...>` type. */
function buildAuth(opts: BetterAuthBrokerOptions, basePath: string) {
  return betterAuth({
    baseURL: opts.baseURL,
    basePath,
    secret: opts.secret,
    // In-memory account store (reference/dev); swap a durable adapter in prod.
    database: memoryAdapter({}),
    socialProviders: {
      ...(opts.google !== undefined ? { google: opts.google } : {}),
      ...(opts.apple !== undefined ? { apple: opts.apple } : {}),
    },
  });
}

export class BetterAuthBroker implements AuthBroker {
  private readonly auth: ReturnType<typeof buildAuth>;
  readonly basePath: string;

  constructor(opts: BetterAuthBrokerOptions) {
    this.basePath = opts.basePath ?? "/api/auth";
    this.auth = buildAuth(opts, this.basePath);
  }

  /** Mount at `${basePath}/*` — Better Auth owns the provider callback there. */
  get nodeHandler(): (req: IncomingMessage, res: ServerResponse) => void {
    return toNodeHandler(this.auth);
  }

  async beginConnect(input: { provider: string; scopes: readonly string[]; callbackURL: string }): Promise<{ url: string }> {
    const res = (await this.auth.api.signInSocial({
      body: {
        provider: input.provider as "google" | "apple",
        callbackURL: input.callbackURL,
        scopes: [...input.scopes],
        disableRedirect: true,
      },
    })) as { url?: string };
    if (res.url === undefined) throw new Error(`Better Auth did not return an authorize URL for '${input.provider}'`);
    return { url: res.url };
  }

  async resolveConnection(input: { headers: Readonly<Record<string, string | undefined>> }): Promise<{ accountRef: string } | undefined> {
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(input.headers) });
    const userId = session?.user?.id;
    if (userId === undefined || userId === null) return undefined;
    // The reference carries the user id; the caller prefixes the provider so the
    // token lookup knows which account to refresh.
    return { accountRef: String(userId) };
  }

  async getAccessToken(accountRef: string): Promise<string> {
    // accountRef is either "userId" or "provider::userId" (see beginConnect binding).
    const [maybeProvider, maybeUser] = accountRef.split(REF_SEP);
    const providerId = maybeUser !== undefined ? maybeProvider : "google";
    const userId = maybeUser ?? maybeProvider;
    const res = (await this.auth.api.getAccessToken({
      body: { providerId: providerId as string, userId: userId as string },
    })) as { accessToken?: string };
    if (res.accessToken === undefined) throw new Error("Better Auth returned no access token for the connected account");
    return res.accessToken;
  }
}
