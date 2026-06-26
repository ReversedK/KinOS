import { beforeAll, describe, expect, it } from "vitest";

import { OllamaRuntime } from "./ollama-runtime.js";

// Live test against the existing/running Ollama (OLLAMA_BASE_URL). It skips when
// no Ollama is reachable, so CI without one stays green. Generation is skipped
// unless at least one model is pulled.
/**
 * Pick a chat-capable model: prefer $OLLAMA_TEST_MODEL, else the first model
 * that is not an embedding model (embedding models reject /api/chat with 400).
 */
function pickChatModel(models: readonly string[]): string | undefined {
  const override = process.env["OLLAMA_TEST_MODEL"];
  if (override !== undefined) return override;
  return models.find((m) => !/embed/i.test(m));
}

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

  it("generates a short completion when a chat model is available", async (ctx) => {
    const model = pickChatModel(models);
    if (!available || model === undefined) ctx.skip();
    const res = await runtime.generate({
      model: model as string,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    expect(typeof res.content).toBe("string");
    expect(res.content.length).toBeGreaterThan(0);
    expect(res.model).toBeTruthy();
  });
});
