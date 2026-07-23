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

  it("declares input schemas so an agent knows a capability's arguments (not a guess)", () => {
    // document.summarize was failing for agents because it advertised no schema —
    // it must declare a required documentId.
    const sum = catalog.get("document.summarize")?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    expect(sum?.properties).toHaveProperty("documentId");
    expect(sum?.required).toContain("documentId");
    // document.search takes an optional query (so it "works" with none).
    const search = catalog.get("document.search")?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    expect(search?.properties).toHaveProperty("query");
    expect(search?.required ?? []).not.toContain("query");
    // calendar.create_event needs a title + start.
    expect((catalog.get("calendar.create_event")?.inputSchema as { required?: string[] } | undefined)?.required).toEqual(["title", "start"]);
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

describe("capability catalog — RFC-009 per-agent model", () => {
  const catalog = defaultCapabilityCatalog();

  it("declares model.set as adult-only, medium-risk, immediate (no approval floor)", () => {
    const cap = catalog.get("model.set");
    expect(cap).toBeDefined();
    expect(cap?.risk).toBe("medium");
    expect(cap?.allowedProfiles).toEqual(["adult"]); // minors can never set a model
    expect(cap?.approvalFloor).toBe(false); // local change is immediate
  });

  it("audits the chosen model + agent, never conversation content", () => {
    const cap = catalog.get("model.set");
    expect(cap?.auditFacts).toContain("model");
    expect(cap?.auditFacts).toContain("resourceId");
    expect(cap?.auditFacts).not.toContain("content");
  });
});
