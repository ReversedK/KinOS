import { describe, expect, it } from "vitest";

import { FakeAuthBroker, OAUTH_STATE_TTL_SECONDS, PendingOAuthStore, type PendingOAuth } from "./oauth.js";

const NOW = "2026-07-16T10:00:00.000Z";
const at = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const pending = (over: Partial<PendingOAuth> = {}): PendingOAuth => ({
  nonce: "n_1",
  sphereId: "sph_1",
  integrationId: "int_google-calendar",
  provider: "google",
  expiresAt: at(OAUTH_STATE_TTL_SECONDS),
  ...over,
});

describe("PendingOAuthStore (RFC-018)", () => {
  it("redeems a nonce once (single use, CSRF + binding)", () => {
    const store = new PendingOAuthStore(() => NOW);
    store.issue(pending());
    expect(store.redeem("n_1")).toMatchObject({ integrationId: "int_google-calendar", provider: "google" });
    expect(store.redeem("n_1")).toBeUndefined(); // replay refused
  });

  it("refuses an unknown or expired nonce", () => {
    let clock = NOW;
    const store = new PendingOAuthStore(() => clock);
    expect(store.redeem("nope")).toBeUndefined();
    store.issue(pending());
    clock = at(OAUTH_STATE_TTL_SECONDS + 1);
    expect(store.redeem("n_1")).toBeUndefined();
  });
});

describe("FakeAuthBroker (RFC-018)", () => {
  it("returns an authorize URL to the callback, resolves an account, and yields a token by reference", async () => {
    const broker = new FakeAuthBroker();
    const { url } = await broker.beginConnect({ provider: "google", scopes: ["calendar.read"], callbackURL: "http://cb/oauth/connected?nonce=n_1" });
    expect(url).toContain("nonce=n_1");
    const resolved = await broker.resolveConnection({ headers: { "x-fake-user": "alice" } });
    expect(resolved?.accountRef).toBe("broker://fake/alice");
    // The token is fetched by reference, never returned by resolveConnection.
    expect(await broker.getAccessToken("google::broker://fake/alice")).toBe("tok_alice");
  });
});
