/**
 * Runtime selection (RFC-004) — app-layer composition.
 *
 * Given a Sphere's RuntimeConfig (and an optional agent model preference), pick
 * the concrete AgentRuntime adapter (Ollama local, OpenAI cloud). This lives in
 * the app layer, not the core: the core defines RuntimeProfile + the deny-by-
 * default gate (assertProfileAllowed) but must never import an adapter
 * (coding principle 1). Cloud credentials are resolved here from a secret
 * reference via an injected resolver — the profile only ever holds the reference.
 */

import {
  assertProfileAllowed,
  resolveEffectiveProfile,
  type AgentRuntime,
  type RuntimeProfile,
  type SphereRuntimeConfig,
} from "@kinos/core";
import { OllamaRuntime } from "@kinos/runtime-ollama";
import { OpenAiRuntime } from "@kinos/runtime-openai";

/** Resolves a secret-store reference to its value (e.g. an API key). */
export interface SecretResolver {
  resolve(ref: string): string | undefined;
}

export interface SelectRuntimeDeps {
  /** Required to build a cloud runtime; resolves the profile's secretRef. */
  readonly secrets?: SecretResolver;
  /** Injectable factories (tests); default to the real adapters. */
  readonly ollamaFactory?: (profile: RuntimeProfile) => AgentRuntime;
  readonly openaiFactory?: (profile: RuntimeProfile, apiKey: string) => AgentRuntime;
}

export interface SelectedRuntime {
  readonly runtime: AgentRuntime;
  readonly profile: RuntimeProfile;
}

function defaultOllama(profile: RuntimeProfile): AgentRuntime {
  return new OllamaRuntime(profile.baseUrl !== undefined ? { baseUrl: profile.baseUrl } : {});
}

function defaultOpenAi(profile: RuntimeProfile, apiKey: string): AgentRuntime {
  return new OpenAiRuntime(profile.baseUrl !== undefined ? { apiKey, baseUrl: profile.baseUrl } : { apiKey });
}

/**
 * Resolve the effective profile, enforce the Sphere's allow rules
 * (deny-by-default), then construct the matching adapter. Throws if the provider
 * is not allowed, if cloud is disabled, or if a cloud profile's secret cannot be
 * resolved — never falls back to a default provider (coding principle 6).
 */
export function selectRuntime(
  config: SphereRuntimeConfig,
  agentModelPreference?: string,
  deps: SelectRuntimeDeps = {},
): SelectedRuntime {
  const profile = resolveEffectiveProfile(config, agentModelPreference);
  assertProfileAllowed(config, profile);

  switch (profile.providerId) {
    case "ollama":
      return { runtime: (deps.ollamaFactory ?? defaultOllama)(profile), profile };
    case "openai": {
      const ref = profile.secretRef;
      const apiKey = ref !== undefined ? deps.secrets?.resolve(ref) : undefined;
      if (apiKey === undefined || apiKey === "") {
        throw new Error("Cloud runtime requires a resolved secret for the profile's secretRef");
      }
      return { runtime: (deps.openaiFactory ?? defaultOpenAi)(profile, apiKey), profile };
    }
    default: {
      // Exhaustiveness guard: an unknown provider is denied, never guessed.
      const unknown: never = profile.providerId;
      throw new Error(`Unsupported provider: ${String(unknown)}`);
    }
  }
}
