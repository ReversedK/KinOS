import { describe, expect, it } from "vitest";

import { HermesRuntime } from "./hermes-runtime.js";

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, statusText: "", json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("HermesRuntime — listModels", () => {
  it("accepts both object and string model lists", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { models: [{ name: "hermes-3" }, "llama3.2"] } }));
    const rt = new HermesRuntime({ baseUrl: "http://hermes:9001/", fetchImpl: impl });
    expect(await rt.listModels()).toEqual(["hermes-3", "llama3.2"]);
    expect(calls[0]?.url).toBe("http://hermes:9001/models");
  });
});

describe("HermesRuntime — generate", () => {
  it("routes the turn to the calling agent's profile and parses the reply", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { model: "hermes-3", reply: "hi there" } }));
    const rt = new HermesRuntime({ baseUrl: "http://hermes:9001", fetchImpl: impl });
    const res = await rt.generate({
      model: "hermes-3",
      agentId: "agt_42",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(res.content).toBe("hi there");
    expect(calls[0]?.url).toBe("http://hermes:9001/agents/agt_42/messages");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("refuses a turn without an agentId (Hermes has no ambient profile)", async () => {
    const { impl } = fakeFetch(() => ({ body: {} }));
    const rt = new HermesRuntime({ fetchImpl: impl });
    await expect(rt.generate({ model: "x", messages: [] })).rejects.toThrow(/agentId/i);
  });

  it("extracts a nested message.content reply shape", async () => {
    const { impl } = fakeFetch(() => ({ body: { message: { content: "nested" } } }));
    const rt = new HermesRuntime({ fetchImpl: impl });
    const res = await rt.generate({ model: "x", agentId: "a", messages: [] });
    expect(res.content).toBe("nested");
  });
});
