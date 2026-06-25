import { describe, expect, it } from "vitest";
import type { AgentRuntime, CapabilityBinding } from "@kinos/core";

import { LocalCapabilityExecutor, modelBackedHandler } from "./local-executor.js";

function binding(runtimeToolName: string): CapabilityBinding {
  return {
    capability: "x.y",
    runtime: "local",
    runtimeToolName,
    execution: "local",
    risk: "low",
    requiresApproval: false,
    status: "enabled",
  };
}

describe("LocalCapabilityExecutor", () => {
  it("dispatches to the handler registered for the binding's runtime tool", async () => {
    const exec = new LocalCapabilityExecutor(
      new Map([["local.echo", async (input: unknown) => ({ echoed: input })]]),
    );
    const out = await exec.execute(binding("local.echo"), { a: 1 });
    expect(out).toEqual({ echoed: { a: 1 } });
  });

  it("fails closed when no handler is registered (binding failure)", async () => {
    const exec = new LocalCapabilityExecutor(new Map());
    await expect(exec.execute(binding("local.missing"), {})).rejects.toThrow(/no local handler/i);
  });
});

describe("modelBackedHandler", () => {
  it("routes the input through the AgentRuntime and returns its completion", async () => {
    const calls: unknown[] = [];
    const runtime: AgentRuntime = {
      listModels: async () => ["m"],
      isAvailable: async () => true,
      async generate(req) {
        calls.push(req);
        return { model: req.model, content: "drafted text" };
      },
    };
    const handler = modelBackedHandler(runtime, { model: "llama3.2", system: "You draft messages." });
    const out = await handler("write a hello", binding("local.draft"));

    expect(out).toEqual({ content: "drafted text", model: "llama3.2" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "llama3.2",
      messages: [
        { role: "system", content: "You draft messages." },
        { role: "user", content: "write a hello" },
      ],
    });
  });
});
