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
    // RFC-049: OpenAI as a generic OAuth2 provider (fake creds + dummy endpoints).
    openai: {
      clientId: "fake-openai-client-id",
      clientSecret: "fake-openai-client-secret",
      authorizeUrl: "https://auth.openai.com/authorize",
      tokenUrl: "https://auth.openai.com/token",
    },
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

  it("RFC-038: requests offline access + consent so Google issues a refresh token", async () => {
    const { url } = await broker().beginConnect({
      provider: "google_drive",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      callbackURL: "http://localhost:8787/oauth/connected?nonce=n_off",
    });
    const u = new URL(url);
    // Without access_type=offline Google returns no refresh token → calls 401 after ~1h.
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });

  it("refuses an unmapped provider before contacting the broker", async () => {
    await expect(
      broker().beginConnect({ provider: "dropbox", scopes: [], callbackURL: "http://localhost:8787/oauth/connected" }),
    ).rejects.toThrow(/no oauth provider mapping/i);
  });

  // RFC-049: OpenAI "Sign in with ChatGPT" — a generic OAuth2 provider connected via
  // the genericOAuth plugin (signInWithOAuth2), reaching the configured OpenAI
  // authorize endpoint with the given scopes. Built offline, no network.
  it("connects the openai provider to its configured authorize endpoint (generic OAuth2)", async () => {
    const { url } = await broker().beginConnect({
      provider: "openai",
      scopes: ["openid", "profile", "email"],
      callbackURL: "http://localhost:8787/oauth/connected?nonce=n_ai",
    });
    const authorize = new URL(url);
    expect(authorize.hostname).toBe("auth.openai.com");
    expect(authorize.pathname).toBe("/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("fake-openai-client-id");
    const scope = decodeURIComponent(authorize.searchParams.get("scope") ?? "");
    expect(scope).toContain("openid");
    expect(scope).toContain("email");
  });
});
