import { describe, expect, it } from "vitest";

import { MapSecretStore, secretStoreFromEnv, type SecretMaterial } from "./secret-store.js";

const basic: SecretMaterial = { kind: "basic", username: "u", password: "p" };

describe("MapSecretStore (RFC-019)", () => {
  it("resolves a known reference to its material", async () => {
    const store = new MapSecretStore({ "secret://caldav/sph_1": basic });
    expect(await store.get("secret://caldav/sph_1")).toEqual(basic);
  });

  it("returns undefined for an unknown reference (deny by default)", async () => {
    const store = new MapSecretStore({ "secret://caldav/sph_1": basic });
    expect(await store.get("secret://caldav/other")).toBeUndefined();
    expect(await new MapSecretStore().get("secret://anything")).toBeUndefined();
  });
});

describe("secretStoreFromEnv", () => {
  it("seeds from a JSON env var", async () => {
    const store = secretStoreFromEnv(JSON.stringify({ "secret://x": { kind: "apiKey", key: "k" } }));
    expect(await store.get("secret://x")).toEqual({ kind: "apiKey", key: "k" });
  });

  it("yields an empty store for missing or malformed input (never crashes boot)", async () => {
    expect(await secretStoreFromEnv(undefined).get("secret://x")).toBeUndefined();
    expect(await secretStoreFromEnv("not json").get("secret://x")).toBeUndefined();
  });
});
