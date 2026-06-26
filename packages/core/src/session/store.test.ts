import { describe, expect, it } from "vitest";

import { InMemorySessionStore } from "./store.js";
import { appendMessage, createSession, deleteSession } from "./session.js";

const T = (m: number) => `2026-06-26T10:0${m}:00.000Z`;

function session(id: string, ownerId: string, now: string, sphereId = "sph_1") {
  return createSession({ id, sphereId, agentId: "agt_1", ownerId, now });
}

describe("InMemorySessionStore (RFC-005)", () => {
  it("saves and loads a clone (callers cannot mutate persisted state)", async () => {
    const store = new InMemorySessionStore();
    const s = appendMessage(session("ses_1", "mbr_p1", T(0)), { id: "m1", role: "user", content: "hi", now: T(1) });
    await store.save(s);
    const loaded = await store.load("ses_1");
    expect(loaded?.messages).toHaveLength(1);
    (loaded?.messages as unknown[]).length = 0; // mutate the returned copy
    expect((await store.load("ses_1"))?.messages).toHaveLength(1); // store unaffected
  });

  it("returns undefined for a missing session", async () => {
    expect(await new InMemorySessionStore().load("nope")).toBeUndefined();
  });

  it("lists an owner's sessions newest-first, excluding deleted and other owners", async () => {
    const store = new InMemorySessionStore();
    await store.save(session("ses_a", "mbr_p1", T(1)));
    await store.save(session("ses_b", "mbr_p1", T(3)));
    await store.save(session("ses_other", "mbr_p2", T(2)));
    await store.save(deleteSession(session("ses_del", "mbr_p1", T(4)), T(5)));

    const list = await store.listForOwner("sph_1", "mbr_p1");
    expect(list.map((s) => s.id)).toEqual(["ses_b", "ses_a"]); // newest-first, no deleted, no other owner
  });

  it("scopes by sphere", async () => {
    const store = new InMemorySessionStore();
    await store.save(session("ses_1", "mbr_p1", T(1), "sph_1"));
    await store.save(session("ses_2", "mbr_p1", T(2), "sph_2"));
    expect((await store.listForOwner("sph_2", "mbr_p1")).map((s) => s.id)).toEqual(["ses_2"]);
  });

  it("deletes idempotently", async () => {
    const store = new InMemorySessionStore();
    await store.save(session("ses_1", "mbr_p1", T(1)));
    await store.delete("ses_1");
    await store.delete("ses_1");
    expect(await store.load("ses_1")).toBeUndefined();
  });
});
