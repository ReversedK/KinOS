import { describe, expect, it } from "vitest";

import {
  createManifest,
  disablePackage,
  enablePackage,
  installPackage,
  isUsable,
  uninstallPackage,
} from "./package.js";

function manifest() {
  return createManifest({
    id: "minecraft-themepark",
    type: "skill",
    title: "Minecraft Theme Park",
    description: "Lets your agent build a themed amusement park in Minecraft.",
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    dependencies: [{ packageId: "minecraft-mcp", versionRange: "^1" }],
    providesCapabilities: ["minecraft.build_structure"],
  });
}

describe("Package (RFC-002)", () => {
  it("builds a manifest with plain description + declared dependencies", () => {
    const m = manifest();
    expect(m.type).toBe("skill");
    expect(m.dependencies[0]?.packageId).toBe("minecraft-mcp");
    expect(m.providesCapabilities).toEqual(["minecraft.build_structure"]);
  });

  it("rejects an empty title or description", () => {
    expect(() => createManifest({ ...manifest(), title: "  " })).toThrow(/title/i);
    expect(() => createManifest({ ...manifest(), description: " " })).toThrow(/description/i);
  });

  it("install makes it installed (not enabled — install is not authorization)", () => {
    const pkg = installPackage(manifest(), "sph_1");
    expect(pkg.status).toBe("installed");
    expect(isUsable(pkg)).toBe(false);
  });

  it("enable/disable transitions immutably; only enabled is usable", () => {
    const pkg = installPackage(manifest(), "sph_1");
    const on = enablePackage(pkg);
    expect(on.status).toBe("enabled");
    expect(isUsable(on)).toBe(true);
    expect(pkg.status).toBe("installed"); // original unchanged
    expect(disablePackage(on).status).toBe("disabled");
    expect(isUsable(disablePackage(on))).toBe(false);
  });

  it("uninstall blocks the future", () => {
    const removed = uninstallPackage(installPackage(manifest(), "sph_1"));
    expect(removed.status).toBe("uninstalled");
    expect(() => enablePackage(removed)).toThrow(/uninstalled/i);
    expect(() => disablePackage(removed)).toThrow(/uninstalled/i);
  });
});
