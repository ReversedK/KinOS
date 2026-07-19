import {
  InMemoryCalendarStore,
  InMemorySphereStore,
  createSphere,
  defaultStoreCatalog,
  exportSphere,
  type CapabilityBinding,
  type ExecutionContext,
  type SphereStore,
} from "@kinos/core";
import { describe, expect, it } from "vitest";

import { buildLocalHandlers } from "./local-handlers.js";

const NOW = "2026-07-16T10:00:00.000Z";
const binding: CapabilityBinding = {
  capability: "x",
  runtime: "local",
  runtimeToolName: "local.echo",
  execution: "local",
  risk: "low",
  requiresApproval: false,
  status: "enabled",
};

const ctx = (sphereId: string, memberId = "mbr_1"): ExecutionContext => ({
  sphereId,
  subject: { memberId, role: "parent", ageProfile: "adult" },
  correlationId: "cor_1",
  execution: "local",
  time: NOW,
});

function env(calendar = new InMemoryCalendarStore(), spheres: SphereStore = new InMemorySphereStore()) {
  let n = 0;
  let m = 0;
  let p = 0;
  const h = buildLocalHandlers({ calendar, spheres, newEventId: () => `evt_${++n}`, newMemoryId: () => `mem_${++m}`, newProjectId: () => `prj_${++p}`, now: () => NOW });
  return { h, calendar, spheres };
}

/** A stored Sphere with two members, so memory ownership/visibility is testable. */
async function seededSphere(): Promise<InMemorySphereStore> {
  const spheres = new InMemorySphereStore();
  const sphere = createSphere({ id: "sph_1", type: "family", name: "Doe", founder: { memberId: "mbr_A", identityId: "idy_A", role: "parent" } });
  await spheres.save(exportSphere({ sphere, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));
  return spheres;
}

describe("local capability handlers", () => {
  it("registers a handler for every local binding in the store catalog", () => {
    const { h } = env();
    for (const pkg of defaultStoreCatalog()) {
      for (const b of pkg.bindings) {
        if (b.runtime !== "local") continue;
        expect(h.has(b.runtimeToolName), `${pkg.id}: no handler for '${b.runtimeToolName}'`).toBe(true);
      }
    }
  });
});

describe("real calendar integration (RFC-012)", () => {
  it("create then read round-trips a real event, scoped from the governed context", async () => {
    const { h } = env();
    const created = (await h.get("local.calendar")!({ title: "Dentist", start: "2026-07-20T09:00:00Z" }, binding, ctx("sph_1"))) as {
      created: boolean;
      event: { sphereId: string; title: string; createdBy?: string };
    };
    expect(created.event).toMatchObject({ sphereId: "sph_1", title: "Dentist", createdBy: "mbr_1" });
    const back = (await h.get("local.calendar_read")!({}, binding, ctx("sph_1"))) as { events: { title: string }[] };
    expect(back.events.map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("isolates Spheres and cannot be forged via input", async () => {
    const { h } = env();
    await h.get("local.calendar")!({ title: "Sneaky", start: "2026-07-20T09:00:00Z", sphereId: "sph_victim" }, binding, ctx("sph_attacker"));
    const victim = (await h.get("local.calendar_read")!({}, binding, ctx("sph_victim"))) as { events: unknown[] };
    expect(victim.events).toEqual([]);
  });

  it("refuses to run without an execution context (fail closed)", async () => {
    const { h } = env();
    await expect(h.get("local.calendar_read")!({}, binding)).rejects.toThrow(/execution context/i);
  });
});

describe("real canonical memory / notes (RFC-013)", () => {
  it("capture records a private note owned by the acting subject", async () => {
    const { h, spheres } = env(new InMemoryCalendarStore(), await seededSphere());
    const out = (await h.get("local.memory_capture")!({ content: "Dentist Friday" }, binding, ctx("sph_1", "mbr_A"))) as {
      captured: boolean;
      visibility: string;
    };
    expect(out).toMatchObject({ captured: true, visibility: "private" });
    const imported = (await spheres.load("sph_1"))!;
    expect(imported.memory).toHaveLength(1);
    expect(imported.memory[0]).toMatchObject({ ownerId: "mbr_A", visibility: "private", content: "Dentist Friday" });
  });

  it("search is policy-scoped: a member never sees another member's private note", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    await h.get("local.memory_capture")!({ content: "A secret" }, binding, ctx("sph_1", "mbr_A"));
    await h.get("local.memory_capture")!({ content: "B secret" }, binding, ctx("sph_1", "mbr_B"));

    const aSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_A"))) as { items: { content: string }[] };
    expect(aSees.items.map((i) => i.content)).toEqual(["A secret"]);
    const bSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_B"))) as { items: { content: string }[] };
    expect(bSees.items.map((i) => i.content)).toEqual(["B secret"]);
  });

  it("share makes a note visible to the named member; then search returns it", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    const cap = (await h.get("local.memory_capture")!({ content: "shared plan" }, binding, ctx("sph_1", "mbr_A"))) as { id: string };
    // Before sharing, B does not see it.
    let bSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_B"))) as { items: unknown[] };
    expect(bSees.items).toEqual([]);
    await h.get("local.memory_share")!({ itemId: cap.id, memberIds: ["mbr_B"] }, binding, ctx("sph_1", "mbr_A"));
    bSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_B"))) as { items: { content: string }[] };
    expect((bSees.items as { content: string }[]).map((i) => i.content)).toEqual(["shared plan"]);
  });

  it("a query substring filters the already-authorized set", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    await h.get("local.memory_capture")!({ content: "Dentist Friday" }, binding, ctx("sph_1", "mbr_A"));
    await h.get("local.memory_capture")!({ content: "Piano lesson" }, binding, ctx("sph_1", "mbr_A"));
    const hit = (await h.get("local.memory_search")!({ query: "dentist" }, binding, ctx("sph_1", "mbr_A"))) as { items: { content: string }[] };
    expect(hit.items.map((i) => i.content)).toEqual(["Dentist Friday"]);
  });

  it("revocation blocks the future, not the past (RFC-015)", async () => {
    const spheres = await seededSphere();
    const { h } = env(new InMemoryCalendarStore(), spheres);
    const cap = (await h.get("local.memory_capture")!({ content: "trip plan" }, binding, ctx("sph_1", "mbr_A"))) as { id: string };
    await h.get("local.memory_share")!({ itemId: cap.id, memberIds: ["mbr_B"] }, binding, ctx("sph_1", "mbr_A"));
    // B sees it after sharing.
    let bSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_B"))) as { items: unknown[] };
    expect(bSees.items).toHaveLength(1);
    // Owner A revokes B's share.
    await h.get("local.memory_revoke")!({ itemId: cap.id, memberId: "mbr_B" }, binding, ctx("sph_1", "mbr_A"));
    // Future access is blocked...
    bSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_B"))) as { items: unknown[] };
    expect(bSees.items).toEqual([]);
    // ...the owner still sees it, and the grant record is retained (revokedAt set).
    const aSees = (await h.get("local.memory_search")!({}, binding, ctx("sph_1", "mbr_A"))) as { items: unknown[] };
    expect(aSees.items).toHaveLength(1);
    const item = (await spheres.load("sph_1"))!.memory.find((m) => m.id === cap.id)!;
    expect(item.shareGrants?.[0]).toMatchObject({ subjectId: "mbr_B", revokedAt: expect.any(String) });
  });

  it("only the note owner may revoke a share", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    const cap = (await h.get("local.memory_capture")!({ content: "owned by A" }, binding, ctx("sph_1", "mbr_A"))) as { id: string };
    await h.get("local.memory_share")!({ itemId: cap.id, memberIds: ["mbr_B"] }, binding, ctx("sph_1", "mbr_A"));
    // B (not the owner) tries to revoke — refused.
    await expect(h.get("local.memory_revoke")!({ itemId: cap.id, memberId: "mbr_B" }, binding, ctx("sph_1", "mbr_B"))).rejects.toThrow(
      /owner may revoke/i,
    );
  });

  it("capture cannot be forged into another Sphere (scope from context)", async () => {
    const spheres = await seededSphere();
    const other = createSphere({ id: "sph_2", type: "family", name: "Other", founder: { memberId: "mbr_X", identityId: "idy_X", role: "parent" } });
    await spheres.save(exportSphere({ sphere: other, identities: [], agents: [], memory: [], policies: [], exportedAt: NOW }));
    const { h } = env(new InMemoryCalendarStore(), spheres);
    await h.get("local.memory_capture")!({ content: "into victim", sphereId: "sph_2" }, binding, ctx("sph_1", "mbr_A"));
    expect((await spheres.load("sph_2"))!.memory).toEqual([]);
    expect((await spheres.load("sph_1"))!.memory).toHaveLength(1);
  });
});

describe("shared notes, projects & documents (RFC-029)", () => {
  it("sphere.note.create writes a Sphere-visible note; document.search finds it", async () => {
    const { h, spheres } = env(new InMemoryCalendarStore(), await seededSphere());
    const out = (await h.get("local.sphere_note_create")!({ content: "Wifi code is hunter2" }, binding, ctx("sph_1", "mbr_A"))) as {
      created: boolean;
      visibility: string;
    };
    expect(out).toMatchObject({ created: true, visibility: "shared_with_sphere" });
    const stored = (await spheres.load("sph_1"))!.memory[0]!;
    expect(stored).toMatchObject({ ownerType: "sphere", visibility: "shared_with_sphere", content: "Wifi code is hunter2" });

    // Any other member's agent can find the shared document.
    const found = (await h.get("local.document_search")!({ query: "wifi" }, binding, ctx("sph_1", "mbr_B"))) as { documents: { content: string }[] };
    expect(found.documents.map((d) => d.content)).toEqual(["Wifi code is hunter2"]);
  });

  it("document.search returns SHARED content only — never a private note", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    await h.get("local.memory_capture")!({ content: "A private secret" }, binding, ctx("sph_1", "mbr_A")); // private
    await h.get("local.sphere_note_create")!({ content: "A shared announcement" }, binding, ctx("sph_1", "mbr_A")); // shared
    // Even the owner's own agent gets only the shared document from document.search.
    const docs = (await h.get("local.document_search")!({}, binding, ctx("sph_1", "mbr_A"))) as { documents: { content: string }[] };
    expect(docs.documents.map((d) => d.content)).toEqual(["A shared announcement"]);
  });

  it("document.summarize summarizes a shared document, but refuses a private one", async () => {
    const { h } = env(new InMemoryCalendarStore(), await seededSphere());
    const shared = (await h.get("local.sphere_note_create")!(
      { content: "The school trip is on Tuesday. Bring a packed lunch. Cost is ten pounds." },
      binding,
      ctx("sph_1", "mbr_A"),
    )) as { id: string };
    const priv = (await h.get("local.memory_capture")!({ content: "my diary" }, binding, ctx("sph_1", "mbr_A"))) as { id: string };

    const sum = (await h.get("local.document_summarize")!({ documentId: shared.id }, binding, ctx("sph_1", "mbr_B"))) as { summary: string };
    expect(sum.summary.length).toBeGreaterThan(0);
    expect(sum.summary.toLowerCase()).toContain("school trip");

    // A private item is not a "document" — summarize refuses it (RFC-028 surfaces cleanly).
    await expect(h.get("local.document_summarize")!({ documentId: priv.id }, binding, ctx("sph_1", "mbr_B"))).rejects.toThrow(/not found/i);
  });

  it("sphere.project.create records a project owned by the acting member", async () => {
    const { h, spheres } = env(new InMemoryCalendarStore(), await seededSphere());
    const out = (await h.get("local.sphere_project_create")!({ title: "Garden makeover", description: "spring" }, binding, ctx("sph_1", "mbr_A"))) as {
      created: boolean;
      id: string;
      title: string;
    };
    expect(out).toMatchObject({ created: true, id: "prj_1", title: "Garden makeover" });
    const projects = (await spheres.load("sph_1"))!.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ ownerId: "mbr_A", ownerType: "member", title: "Garden makeover", description: "spring", state: "active" });
  });
});
