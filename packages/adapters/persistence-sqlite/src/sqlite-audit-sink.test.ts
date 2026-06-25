import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteAuditSink } from "./sqlite-audit-sink.js";

describe("SqliteAuditSink — durable AuditSink", () => {
  let dir: string;
  let dbPath: string;
  let sink: SqliteAuditSink;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kinos-audit-"));
    dbPath = join(dir, "audit.sqlite");
    sink = new SqliteAuditSink(dbPath);
  });

  afterEach(() => {
    sink.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records events and returns a correlation chain in order", () => {
    sink.record({
      type: "capability.requested",
      sphereId: "sph_1",
      actorId: "mbr_p1",
      resourceType: "capability",
      resourceId: "payment.execute",
      correlationId: "cor_1",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    sink.record({
      type: "capability.allowed",
      sphereId: "sph_1",
      decision: "allow",
      reason: "policy pol_x allows",
      policyId: "pol_x",
      policyVersion: 4,
      correlationId: "cor_1",
      createdAt: "2026-06-25T10:00:00.000Z",
    });
    sink.record({ type: "agent.created", sphereId: "sph_1", correlationId: "other", createdAt: "t" });

    const chain = sink.byCorrelation("cor_1");
    expect(chain.map((e) => e.type)).toEqual(["capability.requested", "capability.allowed"]);
    expect(chain[0]?.id).toBe("evt_1");
    expect(chain[1]?.policyId).toBe("pol_x");
    expect(chain[1]?.policyVersion).toBe(4);
  });

  it("persists across a reopen of the same database file (durability)", () => {
    sink.record({ type: "sphere.created", sphereId: "sph_1", correlationId: "cor_d", createdAt: "t" });
    sink.close();

    const reopened = new SqliteAuditSink(dbPath);
    try {
      const chain = reopened.byCorrelation("cor_d");
      expect(chain).toHaveLength(1);
      expect(chain[0]?.type).toBe("sphere.created");
    } finally {
      reopened.close();
    }
  });
});
