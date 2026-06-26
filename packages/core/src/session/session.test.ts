import { describe, expect, it } from "vitest";

import {
  appendMessage,
  archiveSession,
  createSession,
  deleteSession,
  isOwnedBy,
} from "./session.js";

const NOW = "2026-06-26T10:00:00.000Z";
const LATER = "2026-06-26T10:05:00.000Z";

function base() {
  return createSession({ id: "ses_1", sphereId: "sph_1", agentId: "agt_1", ownerId: "mbr_p1", title: "Plans", now: NOW });
}

describe("Session (RFC-005)", () => {
  it("creates an active, empty, owner-bound session", () => {
    const s = base();
    expect(s.state).toBe("active");
    expect(s.messages).toEqual([]);
    expect(s.ownerId).toBe("mbr_p1");
    expect(s.title).toBe("Plans");
    expect(s.createdAt).toBe(NOW);
  });

  it("defaults an empty title", () => {
    const s = createSession({ id: "ses_2", sphereId: "sph_1", agentId: "agt_1", ownerId: "mbr_p1", now: NOW });
    expect(s.title).toBe("New conversation");
  });

  it("appends messages immutably and advances updatedAt", () => {
    const s = base();
    const s1 = appendMessage(s, { id: "msg_1", role: "user", content: "hi", now: LATER, correlationId: "cor_1" });
    expect(s.messages).toEqual([]); // original unchanged
    expect(s1.messages).toHaveLength(1);
    expect(s1.messages[0]).toMatchObject({ id: "msg_1", role: "user", content: "hi", sessionId: "ses_1", correlationId: "cor_1" });
    expect(s1.updatedAt).toBe(LATER);
  });

  it("refuses appending to a non-active session (deny by default)", () => {
    const archived = archiveSession(base(), LATER);
    expect(() => appendMessage(archived, { id: "m", role: "user", content: "x", now: LATER })).toThrow(/archived/i);
  });

  it("archives a session (resumable, kept)", () => {
    const s = archiveSession(base(), LATER);
    expect(s.state).toBe("archived");
    expect(s.updatedAt).toBe(LATER);
  });

  it("deletes a session: blocks future use and clears the transcript", () => {
    const withMsg = appendMessage(base(), { id: "m1", role: "user", content: "secret", now: LATER });
    const deleted = deleteSession(withMsg, LATER);
    expect(deleted.state).toBe("deleted");
    expect(deleted.messages).toEqual([]);
    expect(() => appendMessage(deleted, { id: "m2", role: "user", content: "x", now: LATER })).toThrow(/deleted/i);
  });

  it("knows its owner", () => {
    const s = base();
    expect(isOwnedBy(s, "mbr_p1")).toBe(true);
    expect(isOwnedBy(s, "mbr_c1")).toBe(false);
  });
});
