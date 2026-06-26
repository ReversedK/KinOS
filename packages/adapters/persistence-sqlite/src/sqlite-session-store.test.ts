import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMessage, createSession, deleteSession } from "@kinos/core";

import { SqliteSessionStore } from "./sqlite-session-store.js";

const T = (m: number) => `2026-06-26T10:0${m}:00.000Z`;

function session(id: string, ownerId: string, now: string, sphereId = "sph_1") {
  return createSession({ id, sphereId, agentId: "agt_1", ownerId, now });
}

let dir: string;
let store: SqliteSessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kinos-sessions-"));
  store = new SqliteSessionStore(join(dir, "sessions.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SqliteSessionStore (RFC-005)", () => {
  it("saves and loads a session with its messages", async () => {
    const s = appendMessage(session("ses_1", "mbr_p1", T(0)), { id: "m1", role: "user", content: "hi", now: T(1) });
    await store.save(s);
    const loaded = await store.load("ses_1");
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.ownerId).toBe("mbr_p1");
  });

  it("lists an owner's sessions newest-first, excluding deleted and other owners", async () => {
    await store.save(session("ses_a", "mbr_p1", T(1)));
    await store.save(session("ses_b", "mbr_p1", T(3)));
    await store.save(session("ses_other", "mbr_p2", T(2)));
    await store.save(deleteSession(session("ses_del", "mbr_p1", T(4)), T(5)));
    const list = await store.listForOwner("sph_1", "mbr_p1");
    expect(list.map((s) => s.id)).toEqual(["ses_b", "ses_a"]);
  });

  it("is durable across a reopen of the same file", async () => {
    await store.save(session("ses_1", "mbr_p1", T(0)));
    const path = join(dir, "sessions.sqlite");
    store.close();
    const reopened = new SqliteSessionStore(path);
    try {
      expect((await reopened.load("ses_1"))?.id).toBe("ses_1");
    } finally {
      reopened.close();
      store = new SqliteSessionStore(path); // so afterEach close() is valid
    }
  });
});
