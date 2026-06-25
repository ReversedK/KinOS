import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "@kinos/core";

import { runMvpScenario } from "./scenario.js";

const fakeRuntime: AgentRuntime = {
  listModels: async () => ["test-model"],
  generate: async (r) => ({ model: r.model, content: "ok" }),
  isAvailable: async () => true,
};

describe("MVP §19 acceptance — end-to-end flow", () => {
  it("passes every results-contract §19 criterion in one run", async () => {
    const report = await runMvpScenario({ runtime: fakeRuntime, now: "2026-06-25T10:00:00.000Z" });

    // Every criterion present and passing.
    const byId = Object.fromEntries(report.criteria.map((c) => [c.id, c]));
    const expected = [
      "sphere-created",
      "members-added",
      "agent-per-member",
      "child-denied-private-memory",
      "memory-share-revoke",
      "capability-adult-vs-child",
      "sensitive-action-approval",
      "local-model-runtime",
      "data-export",
    ];
    for (const id of expected) {
      expect(byId[id], `missing criterion ${id}`).toBeDefined();
      expect(byId[id]?.passed, `criterion ${id} failed: ${byId[id]?.detail}`).toBe(true);
    }
    expect(report.criteria).toHaveLength(expected.length);
    expect(report.allPassed).toBe(true);
  });
});
