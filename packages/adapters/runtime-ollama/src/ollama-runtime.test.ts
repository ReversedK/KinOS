import { describe, expect, it } from "vitest";

import { OllamaRuntime } from "./ollama-runtime.js";

/** A minimal fake fetch that records the last call and returns a canned body. */
function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("OllamaRuntime — listModels", () => {
  it("returns the model names from /api/tags", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { models: [{ name: "llama3.2" }, { name: "mistral" }] },
    }));
    const rt = new OllamaRuntime({ baseUrl: "http://example:11434/", fetchImpl: impl });
    expect(await rt.listModels()).toEqual(["llama3.2", "mistral"]);
    expect(calls[0]?.url).toBe("http://example:11434/api/tags"); // trailing slash trimmed
  });

  it("throws on a non-ok response", async () => {
    const { impl } = fakeFetch(() => ({ status: 500, body: {} }));
    const rt = new OllamaRuntime({ fetchImpl: impl });
    await expect(rt.listModels()).rejects.toThrow(/api\/tags failed/);
  });
});

describe("OllamaRuntime — generate", () => {
  it("posts a non-streaming chat request and parses the message content", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { model: "llama3.2", message: { role: "assistant", content: "hi there" } },
    }));
    const rt = new OllamaRuntime({ baseUrl: "http://example:11434", fetchImpl: impl });

    const res = await rt.generate({
      model: "llama3.2",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(res).toEqual({ model: "llama3.2", content: "hi there" });
    const call = calls[0];
    expect(call?.url).toBe("http://example:11434/api/chat");
    expect(call?.init?.method).toBe("POST");
    const sent = JSON.parse(String(call?.init?.body));
    expect(sent.stream).toBe(false);
    expect(sent.model).toBe("llama3.2");
    expect(sent.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("includes Ollama's own reason (e.g. model not found) in the thrown error", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, body: { error: "model 'llama3.2' not found" } }));
    const rt = new OllamaRuntime({ fetchImpl: impl });
    await expect(
      rt.generate({ model: "llama3.2", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/model 'llama3.2' not found/);
  });
});

describe("OllamaRuntime — isAvailable", () => {
  it("is true when the server responds and false when it errors", async () => {
    const up = new OllamaRuntime({ fetchImpl: fakeFetch(() => ({ body: { models: [] } })).impl });
    expect(await up.isAvailable()).toBe(true);

    const down = new OllamaRuntime({
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(await down.isAvailable()).toBe(false);
  });
});
