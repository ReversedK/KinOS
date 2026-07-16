import { describe, expect, it } from "vitest";

import { FakeAuthBroker, OAUTH_STATE_TTL_SECONDS, PendingOAuthStore, type PendingOAuth } from "./oauth.js";

const NOW = "2026-07-16T10:00:00.000Z";
const at = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const pending = (over: Partial<PendingOAuth> = {}): PendingOAuth => ({
  state: "st_1",
  sphereId: "sph_1",
  integrationId: "int_google-calendar",
  provider: "google",
  expiresAt: at(OAUTH_STATE_TTL_SECONDS),
  ...over,
});

describe("PendingOAuthStore (RFC-017)", () => {
  it("redeems a state once (single use, CSRF)", () => {
    const store = new PendingOAuthStore(() => NOW);
    store.issue(pending());
    expect(store.redeem("st_1")).toMatchObject({ integrationId: "int_google-calendar", provider: "google" });
    expect(store.redeem("st_1")).toBeUndefined(); // replay refused
  });

  it("refuses an unknown or expired state", () => {
    let clock = NOW;
    const store = new PendingOAuthStore(() => clock);
    expect(store.redeem("nope")).toBeUndefined();
    store.issue(pending());
    clock = at(OAUTH_STATE_TTL_SECONDS + 1);
    expect(store.redeem("st_1")).toBeUndefined();
  });
});

describe("FakeAuthBroker (RFC-017)", () => {
  it("mints an authorize URL carrying scopes + state, and round-trips a token by reference", async () => {
    const broker = new FakeAuthBroker();
    const url = await broker.authorizeUrl({ provider: "google", scopes: ["calendar.read"], state: "st_1", redirectUri: "http://cb" });
    expect(url).toContain("state=st_1");
    expect(url).toContain("scope=calendar.read");
    const { accountRef } = await broker.exchange({ provider: "google", code: "code_1", state: "st_1", redirectUri: "http://cb" });
    expect(accountRef).not.toContain("code_1"); // a reference, not the token
    expect(await broker.getAccessToken(accountRef)).toBe("tok_google_code_1");
    await expect(broker.getAccessToken("broker://unknown")).rejects.toThrow(/no connected account/i);
  });
});
