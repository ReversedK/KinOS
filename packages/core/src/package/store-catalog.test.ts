import { describe, expect, it } from "vitest";

import { defaultCapabilityCatalog } from "../capability/catalog.js";
import { defaultStoreCatalog, findStorePackage } from "./store-catalog.js";

describe("store catalog (RFC-002)", () => {
  it("offers curated packages with plain descriptions and types", () => {
    const catalog = defaultStoreCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((m) => m.description.length > 0)).toBe(true);
    expect(catalog.map((m) => m.type)).toContain("mcp");
    expect(catalog.map((m) => m.type)).toContain("skill");
  });

  it("a skill declares its mcp dependency (resolved/deduped at install)", () => {
    const themepark = findStorePackage("minecraft-themepark");
    expect(themepark?.dependencies[0]?.packageId).toBe("minecraft-mcp");
  });

  it("returns a fresh copy and undefined for unknown ids", () => {
    expect(defaultStoreCatalog()).not.toBe(defaultStoreCatalog());
    expect(findStorePackage("nope")).toBeUndefined();
  });

  // RFC-011: a package that binds a capability must bind one it provides, that
  // capability must be a known core capability (else the resolver never offers
  // it), and it must carry a grant preset (else enabling binds a tool nobody can
  // ever call). These guards keep every wired package testable end-to-end.
  it("every bound capability is provided, known to the core catalog, and granted", () => {
    const known = new Set(defaultCapabilityCatalog().keys());
    for (const pkg of defaultStoreCatalog()) {
      const provided = new Set(pkg.providesCapabilities);
      const granted = new Set(pkg.defaultPolicies.flatMap((p) => p.capabilityNames));
      for (const b of pkg.bindings) {
        expect(provided.has(b.capability), `${pkg.id}: binds unprovided ${b.capability}`).toBe(true);
        expect(known.has(b.capability), `${pkg.id}: ${b.capability} is not a core catalog capability`).toBe(true);
        expect(granted.has(b.capability), `${pkg.id}: ${b.capability} is bound but not granted`).toBe(true);
      }
    }
  });

  it("grant presets are adult-scoped (minors deny-by-default, RFC-011/invariant 8)", () => {
    for (const pkg of defaultStoreCatalog()) {
      for (const preset of pkg.defaultPolicies) {
        const ages = preset.subjectSelector.ageProfiles ?? [];
        expect(ages, `${pkg.id}: preset must scope by age profile`).not.toHaveLength(0);
        expect(ages.every((a) => a === "adult"), `${pkg.id}: preset grants a minor`).toBe(true);
      }
    }
  });

  it("offers several fully-wired, testable packages", () => {
    const wired = defaultStoreCatalog().filter((m) => m.bindings.length > 0);
    expect(wired.map((m) => m.id)).toEqual(
      expect.arrayContaining(["family-calendar", "family-notes", "household-messaging", "household-payments"]),
    );
  });
});
