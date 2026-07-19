import { describe, expect, it } from "vitest";

import { oauthProviderSpec, providerAuthKind, unionRealScopes, OAUTH_PROVIDERS } from "./oauth-providers.js";

describe("OAuth provider map (RFC-032)", () => {
  it("maps google_drive to the google social login with the read-only Drive scope", () => {
    const spec = oauthProviderSpec("google_drive");
    expect(spec?.socialProvider).toBe("google");
    expect(spec?.scopes).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
  });

  it("maps google (calendar) to the google social login with a real calendar scope", () => {
    const spec = oauthProviderSpec("google");
    expect(spec?.socialProvider).toBe("google");
    expect(spec?.scopes.every((s) => s.startsWith("https://"))).toBe(true);
  });

  it("returns undefined for an unmapped provider (caller refuses)", () => {
    expect(oauthProviderSpec("dropbox")).toBeUndefined();
  });

  it("requests read-only Drive — never a write scope (least scope by purpose)", () => {
    expect(OAUTH_PROVIDERS["google_drive"]?.scopes.some((s) => /drive(\.readonly)?$/.test(s))).toBe(true);
    expect(OAUTH_PROVIDERS["google_drive"]?.scopes.some((s) => s.endsWith("/auth/drive"))).toBe(false);
  });

  it("unions real scopes across providers, deduped (RFC-033)", () => {
    const union = unionRealScopes(["google_drive", "google", "google_drive"]);
    expect(union).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(union).toContain("https://www.googleapis.com/auth/calendar");
    // Deduped: drive appears once despite being listed twice.
    expect(union.filter((s) => s.endsWith("drive.readonly"))).toHaveLength(1);
  });

  it("union ignores unmapped providers (least scope, deny-by-default)", () => {
    expect(unionRealScopes(["dropbox"])).toEqual([]);
    expect(unionRealScopes(["google_drive", "dropbox"])).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
  });

  it("classifies provider auth kind for the config UI (RFC-034)", () => {
    expect(providerAuthKind("local")).toBe("none");
    expect(providerAuthKind("google")).toBe("oauth");
    expect(providerAuthKind("google_drive")).toBe("oauth");
    expect(providerAuthKind("caldav")).toBe("apikey"); // not in the OAuth map → api-key
  });
});
