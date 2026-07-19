import { describe, expect, it } from "vitest";

import { oauthProviderSpec, OAUTH_PROVIDERS } from "./oauth-providers.js";

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
});
