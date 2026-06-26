import { describe, expect, it } from "vitest";

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
});
