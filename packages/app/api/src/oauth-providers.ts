/**
 * KinOS OAuth provider map (RFC-032).
 *
 * A KinOS "provider id" names which integration ADAPTER runs a capability
 * (`google` calendar, `google_drive` documents). That is not the same as the auth
 * broker's SOCIAL provider — the actual OAuth login. Google Drive is the Google
 * login with Drive scopes: adapter `google_drive`, login `google`.
 *
 * This map translates a KinOS provider id to the broker's social provider and the
 * real OAuth scope URLs its capabilities need. It lives in the app layer beside the
 * broker: real provider/scope strings are a provider detail (integration-model —
 * providers live in adapters, not the domain). The abstract scopes on the
 * Integration entity (`documents.read`, `calendar.read`) stay for governance
 * display; the broker uses this map for the actual OAuth request.
 */

export interface OAuthProviderSpec {
  /** The auth broker's social-login provider that actually holds the account. */
  readonly socialProvider: "google" | "apple";
  /** The real OAuth scope URLs to request for this KinOS provider's purpose. */
  readonly scopes: readonly string[];
}

const GOOGLE_CALENDAR = "https://www.googleapis.com/auth/calendar";
const GOOGLE_DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";

/** KinOS provider id → social provider + real OAuth scopes. */
export const OAUTH_PROVIDERS: Readonly<Record<string, OAuthProviderSpec>> = {
  google: { socialProvider: "google", scopes: [GOOGLE_CALENDAR] },
  google_drive: { socialProvider: "google", scopes: [GOOGLE_DRIVE_READONLY] },
  apple: { socialProvider: "apple", scopes: [] },
};

/** Look up a provider spec; undefined for an unmapped provider (caller refuses). */
export function oauthProviderSpec(kinosProvider: string): OAuthProviderSpec | undefined {
  return OAUTH_PROVIDERS[kinosProvider];
}

/**
 * How a provider authorizes (RFC-034), for the config UI to show the right
 * affordance: `local` needs no credential (KinOS's built-in reference); an OAuth
 * provider connects via the broker; anything else authenticates with an api-key
 * reference. One place owns this classification.
 */
export function providerAuthKind(provider: string): "none" | "oauth" | "apikey" {
  if (provider === "local") return "none";
  if (oauthProviderSpec(provider) !== undefined) return "oauth";
  return "apikey";
}

/**
 * The deduped union of real OAuth scope URLs across the given KinOS provider ids
 * (RFC-033). Unmapped providers contribute nothing. Used to request, in one
 * consent, every scope a Sphere's same-social integrations need — so connecting
 * one never drops another's access. Order-stable for a deterministic authorize URL.
 */
export function unionRealScopes(kinosProviders: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of kinosProviders) {
    for (const scope of oauthProviderSpec(p)?.scopes ?? []) {
      if (!seen.has(scope)) {
        seen.add(scope);
        out.push(scope);
      }
    }
  }
  return out;
}
