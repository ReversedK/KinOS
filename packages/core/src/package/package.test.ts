import { describe, expect, it } from "vitest";

import { evaluate } from "../policy/engine.js";
import {
  createManifest,
  disablePackage,
  enablePackage,
  customGrantPolicies,
  installPackage,
  isUsable,
  packageBindings,
  packageGrantPolicies,
  packageIntegration,
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

describe("Package grant wizard (RFC-011)", () => {
  function calendarManifest() {
    return createManifest({
      id: "family-calendar",
      type: "skill",
      title: "Family Calendar",
      description: "Read the family calendar and propose events.",
      version: "1.0.0",
      publisher: "kinos",
      ageRating: "all",
      providesCapabilities: ["calendar.read", "calendar.create_event"],
      bindings: [
        { capability: "calendar.read", runtime: "local", runtimeToolName: "local.calendar_read", execution: "local", risk: "low" },
        { capability: "calendar.create_event", runtime: "local", runtimeToolName: "local.calendar", execution: "local", risk: "medium" },
      ],
      defaultPolicies: [
        { description: "Adults may read the calendar.", subjectSelector: { ageProfiles: ["adult"] }, capabilityNames: ["calendar.read"], effect: "allow" },
      ],
    });
  }

  it("rejects a binding for a capability the package does not provide", () => {
    expect(() =>
      createManifest({
        id: "bad",
        type: "skill",
        title: "Bad",
        description: "x",
        version: "1",
        publisher: "p",
        ageRating: "all",
        providesCapabilities: ["calendar.read"],
        bindings: [{ capability: "payment.execute", runtime: "local", runtimeToolName: "local.pay", execution: "local", risk: "critical" }],
      }),
    ).toThrow(/not in providesCapabilities/i);
  });

  it("materializes bindings disabled on install, enabled on enable (install != authorize)", () => {
    const m = calendarManifest();
    const disabled = packageBindings(m, "disabled");
    expect(disabled.map((b) => b.status)).toEqual(["disabled", "disabled"]);
    expect(disabled[0]).toMatchObject({ capability: "calendar.read", runtimeToolName: "local.calendar_read", status: "disabled" });
    expect(packageBindings(m, "enabled").every((b) => b.status === "enabled")).toBe(true);
  });

  it("emits grant policies with stable ids; the grant authorizes only adults", () => {
    const policies = packageGrantPolicies(calendarManifest(), "sph_1");
    expect(policies[0]?.id).toBe("pol_sph_1_pkg_family-calendar_0");
    const req = (ageProfile: "adult" | "child") => ({
      subject: { role: "parent", ageProfile },
      action: "execute" as const,
      resource: { type: "capability" as const, capabilityName: "calendar.read" },
      context: { sphereId: "sph_1", time: "2026-07-16T10:00:00Z", execution: "local" as const, correlationId: "c" },
    });
    expect(evaluate(req("adult"), policies).effect).toBe("allow");
    // A minor is not covered by the adult-scoped grant → deny by default.
    expect(evaluate(req("child"), policies).effect).toBe("deny");
  });

  it("a package with no bindings/presets materializes nothing (unchanged behaviour)", () => {
    const m = manifest();
    expect(packageBindings(m, "enabled")).toEqual([]);
    expect(packageGrantPolicies(m, "sph_1")).toEqual([]);
  });
});

describe("customGrantPolicies (RFC-014 advanced scoping)", () => {
  const m = () =>
    createManifest({
      id: "family-calendar",
      type: "skill",
      title: "Family Calendar",
      description: "x",
      version: "1",
      publisher: "kinos",
      ageRating: "all",
      providesCapabilities: ["calendar.read", "calendar.create_event"],
    });

  it("materializes an admin clause into a policy with a stable id", () => {
    const [pol] = customGrantPolicies(m(), "sph_1", [{ ageProfiles: ["teen"], capabilities: ["calendar.read"] }]);
    expect(pol?.id).toBe("pol_sph_1_pkg_family-calendar_grant_0");
    expect(pol?.subjectSelector.ageProfiles).toEqual(["teen"]);
    expect(pol?.resourceSelector.capabilityNames).toEqual(["calendar.read"]);
    expect(pol?.effect).toBe("allow");
  });

  it("lets a teen be granted calendar.read (scoped grant beyond the adult default)", () => {
    const policies = customGrantPolicies(m(), "sph_1", [{ ageProfiles: ["teen"], capabilities: ["calendar.read"] }]);
    const d = evaluate(
      {
        subject: { role: "teenager", ageProfile: "teen" },
        action: "execute",
        resource: { type: "capability", capabilityName: "calendar.read" },
        context: { sphereId: "sph_1", time: "2026-07-16T10:00:00Z", execution: "local", correlationId: "c" },
      },
      policies,
    );
    expect(d.effect).toBe("allow");
  });

  it("cannot grant a capability the package does not provide", () => {
    expect(() => customGrantPolicies(m(), "sph_1", [{ roles: ["parent"], capabilities: ["payment.execute"] }])).toThrow(
      /does not provide/i,
    );
  });

  it("rejects an empty selector (no silent grant-to-everyone) and empty capabilities", () => {
    expect(() => customGrantPolicies(m(), "sph_1", [{ capabilities: ["calendar.read"] }])).toThrow(/select at least one/i);
    expect(() => customGrantPolicies(m(), "sph_1", [{ roles: ["parent"], capabilities: [] }])).toThrow(/at least one capability/i);
  });

  it("an approval clause requires an approver role", () => {
    expect(() =>
      customGrantPolicies(m(), "sph_1", [{ roles: ["parent"], capabilities: ["calendar.create_event"], effect: "require_approval" }]),
    ).toThrow(/approver role/i);
  });
});

describe("packageIntegration (RFC-016)", () => {
  const integrationManifest = () =>
    createManifest({
      id: "google-calendar",
      type: "mcp",
      title: "Google Calendar",
      description: "Connect a real calendar service.",
      version: "1",
      publisher: "kinos",
      ageRating: "all",
      providesCapabilities: ["calendar.read", "calendar.create_event"],
      integration: { provider: "google", providerChoices: ["google", "caldav"], scopes: ["calendar.read"] },
    });

  it("materializes a proposed Integration from the manifest (provider + capabilities, no secret)", () => {
    const i = packageIntegration(integrationManifest(), "sph_1", "int_google-calendar")!;
    expect(i).toMatchObject({
      id: "int_google-calendar",
      sphereId: "sph_1",
      provider: "google",
      status: "proposed",
      providesCapabilities: ["calendar.read", "calendar.create_event"],
    });
    expect(i.secretRef).toBeUndefined(); // credentials configured later, by reference
  });

  it("returns undefined for a non-integration package", () => {
    expect(packageIntegration(manifest(), "sph_1", "int_x")).toBeUndefined();
  });
});
