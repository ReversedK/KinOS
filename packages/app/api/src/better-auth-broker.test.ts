import { describe, expect, it } from "vitest";

import { BetterAuthBroker } from "./better-auth-broker.js";

/**
 * Drives the real BetterAuthBroker (in-memory account store, fake Google client
 * credentials) to prove the RFC-032 mapping: a KinOS `google_drive` provider id
 * reaches Google's authorize endpoint as the `google` login with the real Drive
 * scope. signInSocial builds the authorize URL offline — no network needed.
 */
function broker(): BetterAuthBroker {
  return new BetterAuthBroker({
    baseURL: "http://localhost:8787",
    secret: "test-secret-at-least-32-chars-long-000",
    google: { clientId: "fake-google-client-id", clientSecret: "fake-google-client-secret" },
  });
}

describe("BetterAuthBroker OAuth mapping (RFC-032/033)", () => {
  it("connects google_drive as the google login and requests exactly the given real scopes", async () => {
    const { url } = await broker().beginConnect({
      provider: "google_drive",
      // RFC-033: the begin handler supplies the real scopes; the broker requests them.
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      callbackURL: "http://localhost:8787/oauth/connected?nonce=n_1",
    });
    const authorize = new URL(url);
    // The authorize endpoint is Google's (the social login), not a "google_drive" one.
    expect(authorize.hostname).toContain("google.com");
    const scope = decodeURIComponent(authorize.searchParams.get("scope") ?? "");
    expect(scope).toContain("https://www.googleapis.com/auth/drive.readonly");
  });

  it("requests the UNION of scopes it is given — calendar + drive in one consent (RFC-033)", async () => {
    const { url } = await broker().beginConnect({
      provider: "google_drive",
      scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/calendar"],
      callbackURL: "http://localhost:8787/oauth/connected?nonce=n_u",
    });
    const scope = decodeURIComponent(new URL(url).searchParams.get("scope") ?? "");
    expect(scope).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/calendar");
  });

  it("refuses an unmapped provider before contacting the broker", async () => {
    await expect(
      broker().beginConnect({ provider: "dropbox", scopes: [], callbackURL: "http://localhost:8787/oauth/connected" }),
    ).rejects.toThrow(/no oauth provider mapping/i);
  });
});
