import { describe, expect, it } from "vitest";
import {
  assertProfileAllowed,
  createRuntimeProfile,
  defaultRuntimeConfig,
  resolveEffectiveProfile,
  setDefaultRuntimeProfile,
} from "./profile.js";

describe("RuntimeProfile (RFC-004)", () => {
  it("a new Sphere defaults to local Ollama with cloud disabled", () => {
    const config = defaultRuntimeConfig();
    expect(config.defaultProfile.providerId).toBe("ollama");
    expect(config.defaultProfile.execution).toBe("local");
    expect(config.cloudInferenceEnabled).toBe(false);
    expect(config.allowedProviders).toEqual(["ollama"]);
  });

  it("rejects an empty model", () => {
    expect(() =>
      createRuntimeProfile({ providerId: "ollama", model: "  ", execution: "local" }),
    ).toThrow(/model/i);
  });

  it("requires a secret reference for cloud execution (keys by reference)", () => {
    expect(() =>
      createRuntimeProfile({ providerId: "openai", model: "gpt-4o-mini", execution: "cloud" }),
    ).toThrow(/secret/i);
    // never stores the key itself, only a reference
    const profile = createRuntimeProfile({
      providerId: "openai",
      model: "gpt-4o-mini",
      execution: "cloud",
      secretRef: "secret://openai/key",
    });
    expect(profile.secretRef).toBe("secret://openai/key");
  });

  it("denies a provider the Sphere has not allowed (deny by default)", () => {
    const config = defaultRuntimeConfig(); // only ollama allowed
    const cloud = createRuntimeProfile({
      providerId: "openai",
      model: "gpt-4o-mini",
      execution: "cloud",
      secretRef: "secret://openai/key",
    });
    expect(() => assertProfileAllowed(config, cloud)).toThrow(/allow/i);
  });

  it("denies cloud execution while cloud inference is disabled", () => {
    const config = {
      ...defaultRuntimeConfig(),
      allowedProviders: ["ollama", "openai"] as const,
      cloudInferenceEnabled: false,
    };
    const cloud = createRuntimeProfile({
      providerId: "openai",
      model: "gpt-4o-mini",
      execution: "cloud",
      secretRef: "secret://openai/key",
    });
    expect(() => assertProfileAllowed(config, cloud)).toThrow(/cloud/i);
  });

  it("allows a cloud profile once the provider is allowed and cloud is enabled", () => {
    const config = {
      ...defaultRuntimeConfig(),
      allowedProviders: ["ollama", "openai"] as const,
      cloudInferenceEnabled: true,
    };
    const cloud = createRuntimeProfile({
      providerId: "openai",
      model: "gpt-4o-mini",
      execution: "cloud",
      secretRef: "secret://openai/key",
    });
    expect(() => assertProfileAllowed(config, cloud)).not.toThrow();
  });

  it("applies an agent model override as a boring swap (same provider/execution)", () => {
    const config = defaultRuntimeConfig();
    const effective = resolveEffectiveProfile(config, "llama3.2:70b");
    expect(effective.providerId).toBe("ollama");
    expect(effective.execution).toBe("local");
    expect(effective.model).toBe("llama3.2:70b");
  });

  it("returns the Sphere default profile when no agent override is given", () => {
    const config = defaultRuntimeConfig();
    expect(resolveEffectiveProfile(config)).toEqual(config.defaultProfile);
  });

  describe("setDefaultRuntimeProfile", () => {
    it("changes the default profile within the allowed providers (immutably)", () => {
      const config = defaultRuntimeConfig();
      const next = setDefaultRuntimeProfile(
        config,
        createRuntimeProfile({ providerId: "ollama", model: "mistral", execution: "local" }),
      );
      expect(next.defaultProfile.model).toBe("mistral");
      expect(config.defaultProfile.model).toBe("llama3.2"); // original unchanged
      expect(next.allowedProviders).toEqual(config.allowedProviders);
    });

    it("refuses switching to a provider the Sphere does not allow", () => {
      const config = defaultRuntimeConfig(); // ollama only
      const cloud = createRuntimeProfile({
        providerId: "openai",
        model: "gpt-4o-mini",
        execution: "cloud",
        secretRef: "secret://openai/key",
      });
      expect(() => setDefaultRuntimeProfile(config, cloud)).toThrow(/allow/i);
    });

    it("refuses switching to cloud while cloud inference is disabled", () => {
      const config = { ...defaultRuntimeConfig(), allowedProviders: ["ollama", "openai"] as const };
      const cloud = createRuntimeProfile({
        providerId: "openai",
        model: "gpt-4o-mini",
        execution: "cloud",
        secretRef: "secret://openai/key",
      });
      expect(() => setDefaultRuntimeProfile(config, cloud)).toThrow(/cloud/i);
    });
  });
});
