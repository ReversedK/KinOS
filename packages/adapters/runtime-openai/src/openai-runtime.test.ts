import { describe, expect, it } from "vitest";

import { OpenAiRuntime } from "./openai-runtime.js";

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
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("OpenAiRuntime — listModels", () => {
  it("returns the model ids from /models with a bearer token", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] },
    }));
    const rt = new OpenAiRuntime({ apiKey: "sk-test", baseUrl: "https://api.openai.com/v1/", fetchImpl: impl });
    expect(await rt.listModels()).toEqual(["gpt-4o-mini", "gpt-4o"]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models"); // trailing slash trimmed
    const auth = new Headers(calls[0]?.init?.headers).get("authorization");
    expect(auth).toBe("Bearer sk-test");
  });

  it("throws on a non-ok response", async () => {
    const { impl } = fakeFetch(() => ({ status: 401, body: {} }));
    const rt = new OpenAiRuntime({ apiKey: "sk-test", fetchImpl: impl });
    await expect(rt.listModels()).rejects.toThrow(/models failed/);
  });
});

describe("OpenAiRuntime — generate", () => {
  it("posts a chat completion and parses the first choice", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: { model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "hi there" } }] },
    }));
    const rt = new OpenAiRuntime({ apiKey: "sk-test", baseUrl: "https://api.openai.com/v1", fetchImpl: impl });

    const res = await rt.generate({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(res).toEqual({ model: "gpt-4o-mini", content: "hi there" });
    const call = calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.init?.method).toBe("POST");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe("Bearer sk-test");
    const sent = JSON.parse(String(call?.init?.body));
    expect(sent.model).toBe("gpt-4o-mini");
    expect(sent.stream).toBe(false);
    expect(sent.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

describe("OpenAiRuntime — credentials", () => {
  it("refuses to construct without an API key (cloud needs a resolved secret)", () => {
    expect(() => new OpenAiRuntime({ apiKey: "" })).toThrow(/api key/i);
  });

  it("never embeds the key in error messages", async () => {
    const { impl } = fakeFetch(() => ({ status: 500, body: {} }));
    const rt = new OpenAiRuntime({ apiKey: "sk-super-secret", fetchImpl: impl });
    await expect(rt.listModels()).rejects.not.toThrow(/sk-super-secret/);
  });
});

describe("OpenAiRuntime — isAvailable", () => {
  it("is true when the server responds and false when it errors", async () => {
    const up = new OpenAiRuntime({ apiKey: "sk-test", fetchImpl: fakeFetch(() => ({ body: { data: [] } })).impl });
    expect(await up.isAvailable()).toBe(true);

    const down = new OpenAiRuntime({
      apiKey: "sk-test",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(await down.isAvailable()).toBe(false);
  });
});
