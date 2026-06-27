import { describe, expect, it } from "vitest";

import { RUNTIME_GOVERNANCE_TOOLS, runtimeGovernanceBindings } from "./governance.js";

describe("runtimeGovernanceBindings (RFC-007/ADR-007)", () => {
  it("binds the three runtime-governance capabilities to local executor tools, enabled + high-risk", () => {
    const bindings = runtimeGovernanceBindings();
    expect(bindings.map((b) => b.capability).sort()).toEqual([
      "runtime.config.project",
      "runtime.session.backup",
      "runtime.session.restore",
    ]);
    for (const b of bindings) {
      expect(b.status).toBe("enabled");
      expect(b.runtime).toBe("local");
      expect(b.execution).toBe("local");
      expect(b.risk).toBe("high");
      // The catalog carries the approval floor; the binding never lowers it.
      expect(b.requiresApproval).toBe(false);
      expect(b.runtimeToolName).toBe(RUNTIME_GOVERNANCE_TOOLS[b.capability as keyof typeof RUNTIME_GOVERNANCE_TOOLS]);
    }
  });
});
