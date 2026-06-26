import { describe, expect, it } from "vitest";

import { resolveInstallPlan } from "./install-plan.js";
import { createManifest, type PackageManifest } from "./package.js";

function pkg(id: string, deps: string[] = []): PackageManifest {
  return createManifest({
    id,
    type: deps.length > 0 ? "skill" : "mcp",
    title: id,
    description: `The ${id} package.`,
    version: "1.0.0",
    publisher: "kinos",
    ageRating: "all",
    dependencies: deps.map((d) => ({ packageId: d, versionRange: "^1" })),
  });
}

const catalog: readonly PackageManifest[] = [
  pkg("mcp-a"),
  pkg("mcp-b"),
  pkg("skill-x", ["mcp-a"]),
  pkg("bundle", ["skill-x", "mcp-b"]),
];

describe("resolveInstallPlan (RFC-002)", () => {
  it("installs a dependency before its dependent", () => {
    const ids = resolveInstallPlan("skill-x", catalog, []).map((m) => m.id);
    expect(ids).toEqual(["mcp-a", "skill-x"]);
  });

  it("resolves a transitive graph in dependency order, each once", () => {
    const ids = resolveInstallPlan("bundle", catalog, []).map((m) => m.id);
    expect(ids).toEqual(["mcp-a", "skill-x", "mcp-b", "bundle"]);
  });

  it("dedups dependencies already installed (reused, not reinstalled)", () => {
    const ids = resolveInstallPlan("skill-x", catalog, ["mcp-a"]).map((m) => m.id);
    expect(ids).toEqual(["skill-x"]);
  });

  it("returns nothing when the root is already installed", () => {
    expect(resolveInstallPlan("skill-x", catalog, ["skill-x"])).toEqual([]);
  });

  it("throws on an unknown package (fail closed)", () => {
    expect(() => resolveInstallPlan("nope", catalog, [])).toThrow(/not found/i);
    expect(() => resolveInstallPlan("bad", [pkg("bad", ["ghost"])], [])).toThrow(/ghost/i);
  });

  it("throws on a dependency cycle", () => {
    const cyclic = [pkg("a", ["b"]), pkg("b", ["a"])];
    expect(() => resolveInstallPlan("a", cyclic, [])).toThrow(/cycle/i);
  });
});
