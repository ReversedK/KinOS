import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApprovalFromDecision, type PendingSensitiveAction, type PolicyDecision } from "@kinos/core";

import { SqliteApprovalStore } from "./sqlite-approval-store.js";

const NOW = "2026-06-25T10:00:00.000Z";

function decision(): PolicyDecision {
  return {
    effect: "require_approval",
    reason: "needs a parent",
    matchedPolicyId: "pol",
    matchedPolicyVersion: 1,
    approval: { approverRoles: ["parent"], expiresInSeconds: 3600 },
    correlationId: "cor_1",
  };
}

function pending(id: string, sphereId = "sph_1"): PendingSensitiveAction {
  const approval = createApprovalFromDecision({
    id,
    sphereId,
    decision: decision(),
    requestedBy: { agentId: "agt_0", onBehalfOf: "mbr_p1" },
    action: { capabilityName: "payment.execute", riskLevel: "critical", summary: "pay" },
    createdAt: NOW,
  });
  return {
    approval,
    request: {
      subject: { memberId: "mbr_p1", agentId: "agt_0", role: "parent", ageProfile: "adult" },
      capabilityName: "payment.execute",
      input: { amount: 20 },
      context: { sphereId, time: NOW, execution: "local", correlationId: "cor_1" },
    },
  };
}

describe("SqliteApprovalStore", () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteApprovalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kinos-appr-"));
    dbPath = join(dir, "approvals.sqlite");
    store = new SqliteApprovalStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a pending action", async () => {
    await store.save(pending("apr_1"));
    const loaded = await store.load("apr_1");
    expect(loaded?.approval.id).toBe("apr_1");
    expect(loaded?.request.input).toEqual({ amount: 20 });
  });

  it("lists only pending actions, filtered by sphere, and reflects resolution", async () => {
    await store.save(pending("apr_1", "sph_1"));
    await store.save(pending("apr_2", "sph_2"));
    const resolved = pending("apr_1", "sph_1");
    await store.save({ ...resolved, approval: { ...resolved.approval, state: "granted" } });

    expect((await store.listPending()).map((p) => p.approval.id)).toEqual(["apr_2"]);
    expect(await store.listPending("sph_1")).toHaveLength(0);
  });

  it("persists across a reopen of the same database file", async () => {
    await store.save(pending("apr_d"));
    store.close();
    const reopened = new SqliteApprovalStore(dbPath);
    try {
      expect((await reopened.load("apr_d"))?.approval.state).toBe("pending");
    } finally {
      reopened.close();
    }
  });
});
