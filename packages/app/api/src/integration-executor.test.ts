import {
  InMemoryCalendarStore,
  InMemorySphereStore,
  createIntegration,
  createMemoryItem,
  createSphere,
  enableIntegration,
  exportSphere,
  type CapabilityBinding,
  type CapabilityExecutor,
  type ExecutionContext,
  type Integration,
  type MemoryItem,
} from "@kinos/core";
import { describe, expect, it } from "vitest";

import { FakeAuthBroker } from "./oauth.js";
import { MapSecretStore, type SecretMaterial } from "./secret-store.js";
import { IntegrationExecutor, caldavCalendarProvider, googleCalendarProvider, googleDriveProvider, localCalendarProvider, localProvider, type IntegrationProviderAdapter } from "./integration-executor.js";

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

  // RFC-019: a non-OAuth provider resolves its secretRef via the secret store. This
  // asserts the wiring (executor supplies a working `secret()`) and deny-by-default:
  // an unresolvable reference yields undefined so the adapter refuses.
  it("resolves a non-OAuth provider's credentials via the secret store, and denies an unknown ref", async () => {
    const configured = enableIntegration({ ...localIntegration(), provider: "caldav", secretRef: "secret://caldav/sph_1" });
    let seen: unknown;
    const probe: IntegrationProviderAdapter = async (_cap, _in, c) => {
      const material = await c.secret();
      if (material === undefined) throw new Error("caldav is not configured (no credentials resolved)");
      seen = material;
      return { ok: true };
    };
    const registry = new Map<string, IntegrationProviderAdapter>([["caldav", probe]]);

    const resolved = new IntegrationExecutor(throwingFallback, {
      spheres: await storeWith(configured),
      registry,
      secrets: new MapSecretStore({ "secret://caldav/sph_1": { kind: "basic", username: "u", password: "p" } }),
    });
    expect(await resolved.execute(customBinding("calendar.read"), {}, ctx)).toEqual({ ok: true });
    expect(seen).toEqual({ kind: "basic", username: "u", password: "p" });

    const unresolved = new IntegrationExecutor(throwingFallback, {
      spheres: await storeWith(configured),
      registry,
      secrets: new MapSecretStore({}), // ref not present
    });
    await expect(unresolved.execute(customBinding("calendar.read"), {}, ctx)).rejects.toThrow(/not configured/i);
  });
});

describe("googleCalendarProvider (RFC-017)", () => {
  it("resolves a token via the broker and calls the API with a Bearer header", async () => {
    const broker = new FakeAuthBroker();
    let seenAuth: string | undefined;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
      return { ok: true, json: async () => ({ items: [{ id: "g1", summary: "Standup", start: { dateTime: "2026-07-20T09:00:00Z" } }] }) } as Response;
    }) as unknown as typeof fetch;

    const provider = googleCalendarProvider(broker, fakeFetch);
    // secretRef is the account reference the /oauth/connected handler stored.
    const out = (await provider("calendar.read", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, secretRef: "google::broker://fake/alice", secret: async () => undefined, scopes: [], now: () => "", newId: () => "" })) as {
      events: { title: string }[];
    };
    expect(seenAuth).toBe("Bearer tok_alice"); // token came from the broker
    expect(out.events.map((e) => e.title)).toEqual(["Standup"]);
  });

  it("refuses when the integration is not connected (no account reference)", async () => {
    const provider = googleCalendarProvider(new FakeAuthBroker());
    await expect(
      provider("calendar.read", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, correlationId: "c", secret: async () => undefined, scopes: [], now: () => "", newId: () => "" }),
    ).rejects.toThrow(/not connected/i);
  });

  it("RFC-037: reads across exactly the selected calendars (config.calendarIds), tagging each event", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (url: string) => {
      seen.push(new URL(url).pathname);
      const cal = decodeURIComponent(new URL(url).pathname.split("/calendars/")[1]!.split("/events")[0]!);
      return { ok: true, json: async () => ({ items: [{ id: `e_${cal}`, summary: `Event in ${cal}`, start: { dateTime: "2026-07-20T09:00:00Z" } }] }) } as Response;
    }) as unknown as typeof fetch;
    const provider = googleCalendarProvider(new FakeAuthBroker(), fakeFetch);
    const out = (await provider(
      "calendar.read",
      {},
      { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, correlationId: "c", secretRef: "google::broker://fake/alice", secret: async () => undefined, scopes: [], config: { calendarIds: ["work@x", "family@y"] }, now: () => "", newId: () => "" },
    )) as { events: Array<{ calendarId: string }> };
    expect(out.events.map((e) => e.calendarId).sort()).toEqual(["family@y", "work@x"]);
    // It hit exactly the two selected calendars, never `primary`.
    expect(seen.some((p) => p.includes("primary"))).toBe(false);
  });

  it("RFC-037: defaults to primary when no calendars are selected", async () => {
    let path = "";
    const fakeFetch = (async (url: string) => { path = new URL(url).pathname; return { ok: true, json: async () => ({ items: [] }) } as Response; }) as unknown as typeof fetch;
    const provider = googleCalendarProvider(new FakeAuthBroker(), fakeFetch);
    await provider("calendar.read", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, correlationId: "c", secretRef: "google::broker://fake/alice", secret: async () => undefined, scopes: [], now: () => "", newId: () => "" });
    expect(path).toContain("/calendars/primary/events");
  });

  it("RFC-037: calendar.list_calendars lists the account's calendars (id + name only)", async () => {
    const fakeFetch = (async (url: string) => {
      expect(url).toContain("/users/me/calendarList");
      return { ok: true, json: async () => ({ items: [{ id: "primary", summary: "Me", primary: true, accessRole: "owner" }, { id: "fam@g", summary: "Family", accessRole: "writer" }] }) } as Response;
    }) as unknown as typeof fetch;
    const provider = googleCalendarProvider(new FakeAuthBroker(), fakeFetch);
    const out = (await provider("calendar.list_calendars", {}, { sphereId: "sph_1", subject: { role: "parent", ageProfile: "adult" }, correlationId: "c", secretRef: "google::broker://fake/alice", secret: async () => undefined, scopes: [], now: () => "", newId: () => "" })) as { calendars: Array<{ id: string; summary: string }> };
    expect(out.calendars.map((c) => c.summary)).toEqual(["Me", "Family"]);
  });
});

describe("Documents integration providers (RFC-031)", () => {
  const provCtx = (over: Record<string, unknown> = {}) => ({
    sphereId: "sph_1",
    subject: { memberId: "mbr_A", role: "parent" as const, ageProfile: "adult" as const },
    correlationId: "cor_1",
    secret: async () => undefined,
    scopes: [],
    now: () => NOW,
    newId: () => "id_1",
    ...over,
  });

  function sharedNote(id: string, content: string): MemoryItem {
    return { ...createMemoryItem({ id, ownerId: "sph_1", ownerType: "sphere", sphereId: "sph_1", content, source: "manual", now: NOW }), visibility: "shared_with_sphere" };
  }

  async function storeWithMemory(items: MemoryItem[]): Promise<InMemorySphereStore> {
    const spheres = new InMemorySphereStore();
    const sphere = createSphere({ id: "sph_1", type: "family", name: "Doe", founder: { memberId: "mbr_A", identityId: "idy_A", role: "parent" } });
    await spheres.save(exportSphere({ sphere, identities: [], agents: [], memory: items, policies: [], exportedAt: NOW }));
    return spheres;
  }

  it("localProvider: document.search returns shared notes; a private note is never returned", async () => {
    const priv = createMemoryItem({ id: "mem_p", ownerId: "mbr_A", ownerType: "member", sphereId: "sph_1", content: "a private secret", source: "manual", now: NOW });
    const spheres = await storeWithMemory([sharedNote("mem_s", "The wifi code is hunter2"), priv]);
    const provider = localProvider({ calendar: new InMemoryCalendarStore(), spheres });
    const out = (await provider("document.search", { query: "wifi" }, provCtx())) as { documents: { id: string; content: string }[] };
    expect(out.documents.map((d) => d.content)).toEqual(["The wifi code is hunter2"]);
    // The private note is not a document even with an empty query.
    const all = (await provider("document.search", {}, provCtx())) as { documents: { id: string }[] };
    expect(all.documents.map((d) => d.id)).toEqual(["mem_s"]);
  });

  it("localProvider: document.summarize summarizes a shared note but refuses a private one", async () => {
    const priv = createMemoryItem({ id: "mem_p", ownerId: "mbr_A", ownerType: "member", sphereId: "sph_1", content: "diary", source: "manual", now: NOW });
    const spheres = await storeWithMemory([sharedNote("mem_s", "School trip Tuesday. Bring lunch."), priv]);
    const provider = localProvider({ calendar: new InMemoryCalendarStore(), spheres });
    const sum = (await provider("document.summarize", { documentId: "mem_s" }, provCtx())) as { summary: string };
    expect(sum.summary.toLowerCase()).toContain("school trip");
    await expect(provider("document.summarize", { documentId: "mem_p" }, provCtx())).rejects.toThrow(/not found/i);
  });

  it("localProvider: still dispatches calendar.* to the calendar store", async () => {
    const calendar = new InMemoryCalendarStore();
    const provider = localProvider({ calendar, spheres: await storeWithMemory([]) });
    await provider("calendar.create_event", { title: "Dentist", start: "2026-07-20T09:00:00Z" }, provCtx());
    const read = (await provider("calendar.read", {}, provCtx())) as { events: { title: string }[] };
    expect(read.events.map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("googleDriveProvider: document.search issues a Bearer'd full-text files.list query", async () => {
    const broker = new FakeAuthBroker();
    let seen: { url: string; auth?: string } | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: (init?.headers as Record<string, string> | undefined)?.["Authorization"] };
      return { ok: true, json: async () => ({ files: [{ id: "f1", name: "Insurance.pdf" }] }) } as Response;
    }) as unknown as typeof fetch;
    const provider = googleDriveProvider(broker, fakeFetch);
    const out = (await provider("document.search", { query: "insurance" }, provCtx({ secretRef: "google_drive::broker://fake/alice" }))) as { documents: { id: string; content: string }[] };
    expect(seen?.auth).toBe("Bearer tok_alice");
    expect(decodeURIComponent(seen!.url)).toContain("fullText contains \"insurance\"");
    expect(out.documents).toEqual([{ id: "f1", content: "Insurance.pdf" }]);
  });

  it("googleDriveProvider: document.summarize inspects the type, exports a Google Doc as text, and summarizes it", async () => {
    const fakeFetch = (async (url: string) => {
      if (!url.includes("/export")) {
        // metadata lookup: a Google Doc.
        return { ok: true, json: async () => ({ name: "Policy", mimeType: "application/vnd.google-apps.document" }) } as Response;
      }
      expect(url).toContain("/export?mimeType=text%2Fplain");
      return { ok: true, text: async () => "The policy renews in March. Premium is 500. Contact the broker to change cover." } as Response;
    }) as unknown as typeof fetch;
    const provider = googleDriveProvider(new FakeAuthBroker(), fakeFetch);
    const out = (await provider("document.summarize", { documentId: "f1" }, provCtx({ secretRef: "google_drive::broker://fake/alice" }))) as { id: string; summary: string };
    expect(out.id).toBe("f1");
    expect(out.summary.toLowerCase()).toContain("policy renews");
  });

  it("googleDriveProvider: document.summarize degrades gracefully for a non-text file (never a 403 throw)", async () => {
    const fakeFetch = (async (url: string) => {
      expect(url).not.toContain("/export"); // a PDF is never exported
      return { ok: true, json: async () => ({ name: "Scan.pdf", mimeType: "application/pdf" }) } as Response;
    }) as unknown as typeof fetch;
    const provider = googleDriveProvider(new FakeAuthBroker(), fakeFetch);
    const out = (await provider("document.summarize", { documentId: "f2" }, provCtx({ secretRef: "google_drive::broker://fake/alice" }))) as { id: string; summary: string };
    expect(out.summary).toContain("Scan.pdf");
    expect(out.summary.toLowerCase()).toContain("not a text document");
  });

  it("googleDriveProvider: refuses when not connected (no account reference)", async () => {
    await expect(googleDriveProvider(new FakeAuthBroker())("document.search", {}, provCtx())).rejects.toThrow(/not connected/i);
  });
});

describe("caldavCalendarProvider (RFC-019)", () => {
  const material: SecretMaterial = { kind: "basic", username: "alice", password: "app-pw", endpoint: "https://caldav.example/cal/alice/" };
  const ctxWith = (secret: () => Promise<SecretMaterial | undefined>) => ({
    sphereId: "sph_1",
    subject: { role: "parent" as const, ageProfile: "adult" as const },
    secret,
    scopes: [],
    now: () => "2026-07-17T08:00:00.000Z",
    newId: () => "uid_1",
  });

  it("PUTs an iCalendar event with Basic auth to the collection endpoint", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 201, text: async () => "" } as Response;
    }) as unknown as typeof fetch;

    const provider = caldavCalendarProvider(fakeFetch);
    const out = (await provider("calendar.create_event", { title: "Dentist", start: "2026-07-20T09:00:00Z" }, ctxWith(async () => material))) as {
      created: boolean;
      event: { id: string; title: string };
    };
    expect(out.event).toMatchObject({ id: "uid_1", title: "Dentist" });
    expect(seen?.url).toBe("https://caldav.example/cal/alice/uid_1.ics");
    expect(seen?.init?.method).toBe("PUT");
    const headers = seen?.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Basic ${Buffer.from("alice:app-pw").toString("base64")}`);
    expect(String(seen?.init?.body)).toContain("DTSTART:20260720T090000Z");
    expect(String(seen?.init?.body)).toContain("SUMMARY:Dentist");
  });

  it("parses events from a CalDAV multistatus REPORT", async () => {
    const multistatus = [
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><c:calendar-data>',
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:evt-42",
      "DTSTART;TZID=Europe/Paris:20260720T110000",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
      "</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>",
    ].join("\r\n");
    const fakeFetch = (async () => ({ ok: true, status: 207, text: async () => multistatus }) as Response) as unknown as typeof fetch;

    const out = (await caldavCalendarProvider(fakeFetch)("calendar.read", {}, ctxWith(async () => material))) as {
      events: Array<{ id: string; title: string; start: string }>;
    };
    expect(out.events).toEqual([{ id: "evt-42", title: "Standup", start: "20260720T110000" }]);
  });

  it("refuses (deny-by-default) when credentials do not resolve", async () => {
    await expect(caldavCalendarProvider()("calendar.read", {}, ctxWith(async () => undefined))).rejects.toThrow(/not configured/i);
  });

  it("refuses when the resolved material has no endpoint", async () => {
    const noEndpoint: SecretMaterial = { kind: "basic", username: "a", password: "b" };
    await expect(caldavCalendarProvider()("calendar.read", {}, ctxWith(async () => noEndpoint))).rejects.toThrow(/no collection endpoint/i);
  });
});
