import { describe, expect, it } from "vitest";

import {
  createIntegration,
  disableIntegration,
  enableIntegration,
  isActive,
  removeIntegration,
  updateScopes,
} from "./integration.js";

function base() {
  return createIntegration({
    id: "int_1",
    sphereId: "sph_1",
    provider: "google",
    scopes: ["calendar.read"],
    secretRef: "secret://google/oauth",
    providesCapabilities: ["calendar.create_event"],
  });
}

describe("Integration (integration-model.md, RFC-003)", () => {
  it("is created proposed (deny by default) with a secret reference, not a secret", () => {
    const i = base();
    expect(i.status).toBe("proposed");
    expect(isActive(i)).toBe(false);
    expect(i.secretRef).toBe("secret://google/oauth");
    expect(i.providesCapabilities).toEqual(["calendar.create_event"]);
  });

  it("rejects an empty provider", () => {
    expect(() => createIntegration({ id: "x", sphereId: "sph_1", provider: "  " })).toThrow(/provider/i);
  });

  it("carries providerChoices when given (RFC-034), and omits them otherwise", () => {
    const withChoices = createIntegration({ id: "int_2", sphereId: "sph_1", provider: "google_drive", providerChoices: ["local", "google_drive"] });
    expect(withChoices.providerChoices).toEqual(["local", "google_drive"]);
    expect(base().providerChoices).toBeUndefined();
  });

  it("carries provider-specific config when given (RFC-037), and omits it otherwise", () => {
    const withConfig = createIntegration({ id: "int_3", sphereId: "sph_1", provider: "google", config: { calendarIds: ["primary", "fam@g"] } });
    expect(withConfig.config).toEqual({ calendarIds: ["primary", "fam@g"] });
    expect(base().config).toBeUndefined();
  });

  it("enables and disables (immutably)", () => {
    const i = base();
    const on = enableIntegration(i);
    expect(on.status).toBe("enabled");
    expect(isActive(on)).toBe(true);
    expect(i.status).toBe("proposed"); // original unchanged
    expect(disableIntegration(on).status).toBe("disabled");
  });

  it("blocks the future after removal", () => {
    const removed = removeIntegration(base());
    expect(removed.status).toBe("removed");
    expect(() => enableIntegration(removed)).toThrow(/removed/i);
    expect(() => disableIntegration(removed)).toThrow(/removed/i);
  });

  it("updates scopes immutably", () => {
    const i = base();
    const next = updateScopes(i, ["calendar.read", "calendar.write"]);
    expect(next.scopes).toEqual(["calendar.read", "calendar.write"]);
    expect(i.scopes).toEqual(["calendar.read"]);
  });
});
