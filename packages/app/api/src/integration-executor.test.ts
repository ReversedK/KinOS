import {
  InMemoryCalendarStore,
  InMemorySphereStore,
  createIntegration,
  createSphere,
  enableIntegration,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type ExecutionContext,
  type Integration,
} from "@kinos/core";
import { describe, expect, it } from "vitest";

import { FakeAuthBroker } from "./oauth.js";
import { IntegrationExecutor, googleCalendarProvider, localCalendarProvider, type IntegrationProviderAdapter } from "./integration-executor.js";

const NOW = "2026-07-16T10:00:00.000Z";
const ctx: ExecutionContext = {
  sphereId: "sph_1",
  subject: { memberId: "mbr_A", role: "parent", ageProfile: "adult" },
  correlationId: "cor_1",
  execution: "local",
  time: NOW,
};
const customBinding = (cap: string): CapabilityBinding => ({
  capability: cap,
  runtime: "custom",
  runtimeToolName: "int_calendar",
  execution: "local",
  risk: "low",
  requiresApproval: false,
  status: "enabled",
});

const throwingFallback: CapabilityExecutor = {
  execute: async () => {
    throw new Error("fallback should not be called for a custom binding");
  },
};

async function storeWith(integration: Integration): Promise<InMemorySphereStore> {
  const spheres = new InMemorySphereStore();
  const sphere = createSphere({ id: "sph_1", type: "family", name: "Doe", founder: { memberId: "mbr_A", identityId: "idy_A", role: "parent" } });
  await spheres.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], integrations: [integration], exportedAt: NOW }));
  return spheres;
}

function localIntegration(overrides: Partial<Integration> = {}): Integration {
  return { ...createIntegration({ id: "int_calendar", sphereId: "sph_1", provider: "local", providesCapabilities: ["calendar.read", "calendar.create_event"] }), ...overrides };
}

describe("IntegrationExecutor (RFC-016 inc.2)", () => {
  function exec(spheres: InMemorySphereStore, calendar = new InMemoryCalendarStore(), registry?: Map<string, IntegrationProviderAdapter>) {
    let n = 0;
    return new IntegrationExecutor(throwingFallback, {
      spheres,
      registry: registry ?? new Map([["local", localCalendarProvider(calendar)]]),
      now: () => NOW,
      newId: () => `evt_${++n}`,
    });
  }

  it("delegates a non-integration binding to the fallback", async () => {
    const spheres = await storeWith(enableIntegration(localIntegration()));
    const fallback: CapabilityExecutor = { execute: async () => ({ viaFallback: true }) };
    const e = new IntegrationExecutor(fallback, { spheres, registry: new Map() });
    const localBinding = { ...customBinding("x"), runtime: "local" as const };
    expect(await e.execute(localBinding, {}, ctx)).toEqual({ viaFallback: true });
  });

  it("dispatches calendar.read/create to the built-in local provider and round-trips", async () => {
    const calendar = new InMemoryCalendarStore();
    const e = exec(await storeWith(enableIntegration(localIntegration())), calendar);
    const created = (await e.execute(customBinding("calendar.create_event"), { title: "Dentist", start: "2026-07-20T09:00:00Z" }, ctx)) as {
      created: boolean;
      event: { sphereId: string; createdBy?: string };
    };
    expect(created.event).toMatchObject({ sphereId: "sph_1", createdBy: "mbr_A" });
    const read = (await e.execute(customBinding("calendar.read"), {}, ctx)) as { events: { title: string }[] };
    expect(read.events.map((ev) => ev.title)).toEqual(["Dentist"]);
  });

  it("refuses when the integration is not enabled (deny by default)", async () => {
    const e = exec(await storeWith(localIntegration())); // status proposed
    await expect(e.execute(customBinding("calendar.read"), {}, ctx)).rejects.toThrow(/not enabled/i);
  });

  it("refuses an external provider with no configured credentials", async () => {
    const google = enableIntegration({ ...localIntegration(), provider: "google" }); // no secretRef
    const e = exec(await storeWith(google));
    await expect(e.execute(customBinding("calendar.read"), {}, ctx)).rejects.toThrow(/not configured/i);
  });

  it("refuses a provider with no registered adapter (drop-in not installed)", async () => {
    const google = enableIntegration({ ...localIntegration(), provider: "google", secretRef: "secret://google/sph_1" });
    const e = exec(await storeWith(google));
    await expect(e.execute(customBinding("calendar.read"), {}, ctx)).rejects.toThrow(/no adapter installed for provider 'google'/i);
  });

  it("refuses an unknown integration id", async () => {
    const e = exec(await storeWith(enableIntegration(localIntegration())));
    await expect(e.execute({ ...customBinding("calendar.read"), runtimeToolName: "int_missing" }, {}, ctx)).rejects.toThrow(/not found/i);
  });
});

describe("googleCalendarProvider (RFC-017)", () => {
  it("resolves a token via the broker and calls the API with a Bearer header", async () => {
    const broker = new FakeAuthBroker();
    const { accountRef } = await broker.exchange({ provider: "google", code: "c1", state: "s1", redirectUri: "http://cb" });
    let seenAuth: string | undefined;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return { ok: true, json: async () => ({ items: [{ id: "g1", summary: "Standup", start: { dateTime: "2026-07-20T09:00:00Z" } }] }) } as Response;
    }) as unknown as typeof fetch;

    const provider = googleCalendarProvider(broker, fakeFetch);
    const out = (await provider("calendar.read", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, secretRef: accountRef, scopes: [], now: () => "", newId: () => "" })) as {
      events: { title: string }[];
    };
    expect(seenAuth).toBe("Bearer tok_google_c1"); // token came from the broker
    expect(out.events.map((e) => e.title)).toEqual(["Standup"]);
  });

  it("refuses when the integration is not connected (no account reference)", async () => {
    const provider = googleCalendarProvider(new FakeAuthBroker());
    await expect(
      provider("calendar.read", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, scopes: [], now: () => "", newId: () => "" }),
    ).rejects.toThrow(/not connected/i);
  });
});
