import { describe, expect, it } from "vitest";

import { defaultCapabilityCatalog } from "./catalog.js";

describe("capability catalog — RFC-007 runtime governance", () => {
  const catalog = defaultCapabilityCatalog();

  it("declares the three runtime governance capabilities as high-risk admin-only", () => {
    for (const name of ["runtime.config.project", "runtime.session.backup", "runtime.session.restore"]) {
      const cap = catalog.get(name);
      expect(cap, name).toBeDefined();
      expect(cap?.risk).toBe("high");
      // Admin/owner only — never a minor profile (deny by default).
      expect(cap?.allowedProfiles).toEqual(["adult"]);
    }
  });

  it("requires approval to (re)project config and to restore runtime state", () => {
    // config.project rewrites the agent's governance config; restore overwrites
    // its working state — both carry an approval floor (capability-catalog.md).
    expect(catalog.get("runtime.config.project")?.approvalFloor).toBe(true);
    expect(catalog.get("runtime.session.restore")?.approvalFloor).toBe(true);
    // Backup is non-destructive: governed/audited but no approval floor.
    expect(catalog.get("runtime.session.backup")?.approvalFloor).toBe(false);
  });

  it("audits the projection version / surface, never config secrets", () => {
    const project = catalog.get("runtime.config.project");
    expect(project?.auditFacts).toContain("projectionVersion");
    expect(project?.auditFacts).not.toContain("secret");
  });
});
