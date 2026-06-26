import { describe, expect, it } from "vitest";

import {
  createRuntimeProfile,
  defaultRuntimeConfig,
  type SphereRuntimeConfig,
} from "@kinos/core";
import { OllamaRuntime } from "@kinos/runtime-ollama";
import { OpenAiRuntime } from "@kinos/runtime-openai";

import { selectRuntime } from "./runtime-select.js";

function cloudConfig(): SphereRuntimeConfig {
  return {
    defaultProfile: createRuntimeProfile({
      providerId: "openai",
      model: "gpt-4o-mini",
      execution: "cloud",
      secretRef: "secret://openai/key",
    }),
    allowedProviders: ["ollama", "openai"],
    cloudInferenceEnabled: true,
  };
}

describe("selectRuntime (RFC-004)", () => {
  it("builds the Ollama adapter for a local-first Sphere", () => {
    const { runtime, profile } = selectRuntime(defaultRuntimeConfig());
    expect(runtime).toBeInstanceOf(OllamaRuntime);
    expect(profile.providerId).toBe("ollama");
  });

  it("applies an agent model override (boring swap) to the selected profile", () => {
    const { profile } = selectRuntime(defaultRuntimeConfig(), "llama3.2:70b");
    expect(profile.providerId).toBe("ollama");
    expect(profile.model).toBe("llama3.2:70b");
  });

  it("builds the OpenAI adapter when cloud is allowed and the secret resolves", () => {
    const seen: string[] = [];
    const { runtime } = selectRuntime(cloudConfig(), undefined, {
      secrets: { resolve: (ref) => (seen.push(ref), "sk-resolved") },
    });
    expect(runtime).toBeInstanceOf(OpenAiRuntime);
    expect(seen).toEqual(["secret://openai/key"]);
  });

  it("denies a provider the Sphere has not allowed (deny by default)", () => {
    const config: SphereRuntimeConfig = { ...cloudConfig(), allowedProviders: ["ollama"] };
    expect(() => selectRuntime(config, undefined, { secrets: { resolve: () => "sk" } })).toThrow(/allow/i);
  });

  it("denies cloud when the Sphere has cloud inference disabled", () => {
    const config: SphereRuntimeConfig = { ...cloudConfig(), cloudInferenceEnabled: false };
    expect(() => selectRuntime(config, undefined, { secrets: { resolve: () => "sk" } })).toThrow(/cloud/i);
  });

  it("refuses a cloud profile whose secret cannot be resolved (no fallback)", () => {
    expect(() => selectRuntime(cloudConfig(), undefined, { secrets: { resolve: () => undefined } })).toThrow(/secret/i);
    // and when no resolver is provided at all
    expect(() => selectRuntime(cloudConfig())).toThrow(/secret/i);
  });
});
