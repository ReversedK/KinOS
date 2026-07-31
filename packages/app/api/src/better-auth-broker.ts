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
 * the provider client credentials (GOOGLE_CLIENT_ID/SECRET, Apple keys).
 *
 * Account store: durable SQLite by default (`databaseFile`), so connected accounts
 * and their refresh tokens survive an API restart — an OAuth "connected" connector
 * must not silently break on redeploy (revocable/durable-by-default). Better Auth
 * uses its built-in Kysely adapter for a raw `better-sqlite3` handle, which lets
 * `migrate()` create the schema at startup with no CLI step. Omit `databaseFile`
 * (tests) to fall back to the in-memory adapter, which needs no migration.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";

import { oauthProviderSpec } from "./oauth-providers.js";

import type { AuthBroker } from "./oauth.js";

export interface BetterAuthBrokerOptions {
  readonly baseURL: string;
  readonly basePath?: string;
  readonly secret: string;
  /** SQLite file for the durable account store. Omit for the in-memory adapter (tests). */
  readonly databaseFile?: string;
  readonly google?: { clientId: string; clientSecret: string };
  readonly apple?: { clientId: string; clientSecret: string };
  /**
   * RFC-049: OpenAI "Sign in with ChatGPT" as a Better Auth *generic* OAuth2
   * provider. The authorize/token endpoints are deployment config (OpenAI's real
   * URLs are provisioned by the operator) — unset ⇒ the provider is not registered
   * (exactly like Google), so the option surfaces only when actually configured.
   */
  readonly openai?: { clientId: string; clientSecret: string; authorizeUrl: string; tokenUrl: string };
}

const REF_SEP = "::";

/** Extracted so the instance field infers the concrete `Auth<...>` type. */
function buildAuth(opts: BetterAuthBrokerOptions, basePath: string) {
  return betterAuth({
    baseURL: opts.baseURL,
    basePath,
    secret: opts.secret,
    // Durable SQLite (Kysely adapter) when a file is given; in-memory otherwise.
    database: opts.databaseFile !== undefined ? new Database(opts.databaseFile) : memoryAdapter({}),
    // RFC-035: KinOS's governed broker calls signInSocial server-side and returns
    // only a URL (RFC-018), so Better Auth's CSRF `state` cookie never reaches the
    // browser and the callback would fail `state_mismatch`. Skip the cookie check —
    // the state DATA (PKCE verifier) still lives server-side (database strategy), and
    // KinOS supplies the CSRF binding via the single-use, admin-minted `nonce` at
    // /oauth/connected (PendingOAuthStore).
    account: { skipStateCookieCheck: true },
    socialProviders: {
      // RFC-038: request OFFLINE access + consent so Google issues a REFRESH token.
      // Without this, Google returns only a ~1h access token and no refresh token, so
      // getAccessToken cannot refresh and every call 401s once the token expires
      // (worked right after connecting, failed hours later). `prompt: "consent"`
      // forces a refresh token even on re-consent for an already-connected account.
      ...(opts.google !== undefined ? { google: { ...opts.google, accessType: "offline", prompt: "consent" } } : {}),
      ...(opts.apple !== undefined ? { apple: opts.apple } : {}),
    },
    // RFC-049: register OpenAI as a generic OAuth2 provider when configured. Its
    // authorize/token endpoints come from deployment config; the broker treats it
    // uniformly (beginConnect → signInWithOAuth2, getAccessToken by providerId).
    ...(opts.openai !== undefined
      ? {
          plugins: [
            genericOAuth({
              config: [
                {
                  providerId: "openai",
                  clientId: opts.openai.clientId,
                  clientSecret: opts.openai.clientSecret,
                  authorizationUrl: opts.openai.authorizeUrl,
                  tokenUrl: opts.openai.tokenUrl,
                },
              ],
            }),
          ],
        }
      : {}),
  });
}

export class BetterAuthBroker implements AuthBroker {
  private readonly auth: ReturnType<typeof buildAuth>;
  private readonly durable: boolean;
  readonly basePath: string;

  constructor(opts: BetterAuthBrokerOptions) {
    this.basePath = opts.basePath ?? "/api/auth";
    this.durable = opts.databaseFile !== undefined;
    this.auth = buildAuth(opts, this.basePath);
  }

  /**
   * Create/upgrade the account schema in the durable store. Idempotent — it diffs
   * the existing tables against Better Auth's schema and only applies what is
   * missing. No-op for the in-memory adapter (no migration engine there). Call
   * once at startup before serving; the provider callback writes accounts here.
   */
  async migrate(): Promise<void> {
    if (!this.durable) return;
    const { runMigrations } = await getMigrations(this.auth.options);
    await runMigrations();
  }

  /** Mount at `${basePath}/*` — Better Auth owns the provider callback there. */
  get nodeHandler(): (req: IncomingMessage, res: ServerResponse) => void {
    return toNodeHandler(this.auth);
  }

  async beginConnect(input: { provider: string; scopes: readonly string[]; callbackURL: string }): Promise<{ url: string }> {
    // RFC-032: a KinOS provider id (e.g. `google_drive`) is an adapter, not a login —
    // map it to the broker's social provider. RFC-033: the caller (the begin handler,
    // which has the Sphere context) supplies the REAL OAuth scopes to request — the
    // union across the Sphere's same-social integrations — so one consent covers them
    // all. The broker only requests what it is given; real scope STRINGS still live
    // solely in oauth-providers.ts.
    const spec = oauthProviderSpec(input.provider);
    if (spec === undefined) throw new Error(`No OAuth provider mapping for '${input.provider}'`);
    // RFC-049: a generic OAuth2 provider (e.g. OpenAI "Sign in with ChatGPT") is
    // connected via the genericOAuth plugin's signInWithOAuth2, keyed by providerId;
    // built-in social providers (Google/Apple) via signInSocial. Both return only a URL.
    if (spec.generic === true) {
      // The genericOAuth plugin is registered conditionally, so its endpoints are not
      // in the statically-inferred api type; call through a narrow typed view.
      const api = this.auth.api as unknown as {
        signInWithOAuth2: (args: {
          body: { providerId: string; callbackURL: string; scopes: string[]; disableRedirect: boolean };
        }) => Promise<{ url?: string }>;
      };
      if (typeof api.signInWithOAuth2 !== "function") {
        throw new Error(`Generic OAuth provider '${input.provider}' is not configured`);
      }
      const res = await api.signInWithOAuth2({
        body: {
          providerId: spec.socialProvider,
          callbackURL: input.callbackURL,
          scopes: [...input.scopes],
          disableRedirect: true,
        },
      });
      if (res.url === undefined) throw new Error(`Better Auth did not return an authorize URL for '${input.provider}'`);
      return { url: res.url };
    }
    const res = (await this.auth.api.signInSocial({
      body: {
        provider: spec.socialProvider,
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
    // accountRef is either "userId" or "kinosProvider::userId" (see beginConnect
    // binding). RFC-032: refresh under the SOCIAL provider that actually holds the
    // account — `google_drive::u1` is stored under `google`, not `google_drive`.
    const [maybeProvider, maybeUser] = accountRef.split(REF_SEP);
    const kinosProvider = maybeUser !== undefined ? maybeProvider : "google";
    const userId = maybeUser ?? maybeProvider;
    const socialProvider = oauthProviderSpec(kinosProvider ?? "google")?.socialProvider ?? kinosProvider;
    const res = (await this.auth.api.getAccessToken({
      body: { providerId: socialProvider as string, userId: userId as string },
    })) as { accessToken?: string };
    if (res.accessToken === undefined) throw new Error("Better Auth returned no access token for the connected account");
    return res.accessToken;
  }
}
