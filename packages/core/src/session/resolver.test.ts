import { describe, expect, it } from "vitest";

import { authorizeSessionRead, resolveReadableSessions } from "./resolver.js";
import { createSession, deleteSession } from "./session.js";
import type { Policy, PolicyRequest } from "../policy/types.js";

const NOW = "2026-06-26T10:00:00.000Z";
const ctx = { sphereId: "sph_1", time: NOW, correlationId: "cor_1" };

const owner: PolicyRequest["subject"] = { memberId: "mbr_p1", role: "parent", ageProfile: "adult" };
const other: PolicyRequest["subject"] = { memberId: "mbr_p2", role: "parent", ageProfile: "adult" };

function ses(ownerId: string) {
  return createSession({ id: "ses_1", sphereId: "sph_1", agentId: "agt_1", ownerId, now: NOW });
}

describe("Session resolver (RFC-005)", () => {
  it("allows the owner to read their own session", () => {
    expect(authorizeSessionRead(owner, ses("mbr_p1"), [], ctx).effect).toBe("allow");
  });

  it("denies a non-owner by default (owner-private)", () => {
    expect(authorizeSessionRead(other, ses("mbr_p1"), [], ctx).effect).toBe("deny");
  });

  it("never surfaces a deleted session", () => {
    expect(authorizeSessionRead(owner, deleteSession(ses("mbr_p1"), NOW), [], ctx).effect).toBe("deny");
  });

  it("lets a real deny policy override the owner's structural access", () => {
    const denyAll: Policy = {
      id: "pol_deny",
      sphereId: "sph_1",
      description: "Sessions locked during an investigation.",
      subjectSelector: {},
      action: "read",
      resourceSelector: { types: ["session"] },
      effect: "deny",
      priority: 100,
      version: 1,
      status: "active",
    };
    expect(authorizeSessionRead(owner, ses("mbr_p1"), [denyAll], ctx).effect).toBe("deny");
  });

  it("filters a list to only the subject's readable sessions", () => {
    const mine = createSession({ id: "a", sphereId: "sph_1", agentId: "agt_1", ownerId: "mbr_p1", now: NOW });
    const theirs = createSession({ id: "b", sphereId: "sph_1", agentId: "agt_1", ownerId: "mbr_p2", now: NOW });
    const out = resolveReadableSessions(owner, [mine, theirs], [], ctx);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });
});
