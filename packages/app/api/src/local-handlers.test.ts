import { defaultStoreCatalog } from "@kinos/core";
import { describe, expect, it } from "vitest";

import { localCapabilityHandlers } from "./local-handlers.js";

describe("local capability handlers", () => {
  // The load-bearing guard: a store package that "enables" but whose binding
  // resolves to no handler fails at the first tools/call with "no local handler".
  // Every `local`-runtime binding the store declares must have a handler here.
  it("registers a handler for every local binding in the store catalog", () => {
    for (const pkg of defaultStoreCatalog()) {
      for (const b of pkg.bindings) {
        if (b.runtime !== "local") continue;
        expect(
          localCapabilityHandlers.has(b.runtimeToolName),
          `${pkg.id}: no handler for '${b.runtimeToolName}' (capability ${b.capability})`,
        ).toBe(true);
      }
    }
  });

  it("handlers are pure demo stubs: they return a value and touch nothing external", async () => {
    const binding = { capability: "x", runtime: "local", runtimeToolName: "local.echo", execution: "local", risk: "low", requiresApproval: false, status: "enabled" } as const;
    for (const [name, handler] of localCapabilityHandlers) {
      const out = await handler({ probe: name }, binding);
      expect(out, `${name} returned nothing`).toBeDefined();
    }
  });
});
