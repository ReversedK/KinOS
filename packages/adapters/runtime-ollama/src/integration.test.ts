import { beforeAll, describe, expect, it } from "vitest";

import { OllamaRuntime } from "./ollama-runtime.js";

// Live test against the existing/running Ollama (OLLAMA_BASE_URL). It skips when
// no Ollama is reachable, so CI without one stays green. Generation is skipped
// unless at least one model is pulled.
describe("OllamaRuntime — live (skipped when no Ollama is reachable)", () => {
  const runtime = new OllamaRuntime();
  let available = false;
  let models: readonly string[] = [];

  beforeAll(async () => {
    available = await runtime.isAvailable();
    if (available) models = await runtime.listModels();
  });

  it("lists models from the running Ollama", async (ctx) => {
    if (!available) ctx.skip();
    expect(Array.isArray(models)).toBe(true);
  });

  it("generates a short completion when a model is available", async (ctx) => {
    if (!available || models.length === 0) ctx.skip();
    const res = await runtime.generate({
      model: models[0] as string,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    expect(typeof res.content).toBe("string");
    expect(res.model).toBeTruthy();
  });
});
