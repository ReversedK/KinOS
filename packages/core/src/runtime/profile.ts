/**
 * RuntimeProfile — the Sphere's selected inference provider and model
 * (RFC-004, domain-model.md).
 *
 * Configuration, not a model dependency: the domain references the AgentRuntime
 * port (runtime.ts), never a provider SDK (coding principle 1). This module is
 * pure structural config + deny-by-default validation. Subject authorization
 * (e.g. minors denied cloud, the high-risk grant to enable a cloud provider)
 * belongs to the Policy Engine, not here.
 */

export type RuntimeProviderId = "ollama" | "openai";

/** Whether inference stays on the local machine or leaves it (external transfer). */
export type RuntimeExecution = "local" | "cloud";

export interface RuntimeProfile {
  readonly providerId: RuntimeProviderId;
  readonly model: string;
  readonly execution: RuntimeExecution;
  /** Optional endpoint for self-hosted / OpenAI-compatible servers. */
  readonly baseUrl?: string;
  /** Secret-store reference for cloud credentials — never the key itself. */
  readonly secretRef?: string;
}

export interface SphereRuntimeConfig {
  /** Used when no agent override is given. */
  readonly defaultProfile: RuntimeProfile;
  /** Providers the Sphere permits; anything outside is denied by default. */
  readonly allowedProviders: readonly RuntimeProviderId[];
  /** Master switch: cloud inference is off until explicitly enabled. */
  readonly cloudInferenceEnabled: boolean;
}

export interface CreateRuntimeProfileInput {
  readonly providerId: RuntimeProviderId;
  readonly model: string;
  readonly execution: RuntimeExecution;
  readonly baseUrl?: string;
  readonly secretRef?: string;
}

/**
 * Validate and normalise a RuntimeProfile. Cloud execution requires a secret
 * reference so that credentials live in the secret store by reference, never in
 * the profile, audit or exports (RFC-004).
 */
export function createRuntimeProfile(input: CreateRuntimeProfileInput): RuntimeProfile {
  const model = input.model.trim();
  if (model.length === 0) {
    throw new Error("RuntimeProfile model must not be empty");
  }
  if (input.execution === "cloud" && (input.secretRef === undefined || input.secretRef.trim() === "")) {
    throw new Error("Cloud execution requires a secret reference (credentials by reference only)");
  }
  return {
    providerId: input.providerId,
    model,
    execution: input.execution,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.secretRef !== undefined ? { secretRef: input.secretRef } : {}),
  };
}

/** A new Sphere is local-first: Ollama only, cloud off (RFC-004, invariant 13). */
export function defaultRuntimeConfig(): SphereRuntimeConfig {
  return {
    defaultProfile: { providerId: "ollama", model: "llama3.2", execution: "local" },
    allowedProviders: ["ollama"],
    cloudInferenceEnabled: false,
  };
}

/**
 * Deny-by-default check that a profile is permitted by the Sphere config:
 * the provider must be allowed, and cloud execution requires cloud inference to
 * be enabled. This is structural config gating, not subject authorization.
 */
export function assertProfileAllowed(config: SphereRuntimeConfig, profile: RuntimeProfile): void {
  if (!config.allowedProviders.includes(profile.providerId)) {
    throw new Error(`Provider '${profile.providerId}' is not allowed in this Sphere`);
  }
  if (profile.execution === "cloud" && !config.cloudInferenceEnabled) {
    throw new Error("Cloud inference is disabled for this Sphere");
  }
}

/**
 * Change a Sphere's default inference profile (RFC-004), keeping the allowed
 * providers and cloud flag. Deny-by-default: the new profile must pass
 * `assertProfileAllowed` (provider allowed; cloud only when cloud is enabled),
 * so this never widens what the Sphere permits — switching to a disallowed
 * provider or to cloud while cloud is disabled is refused. Immutable: returns a
 * new config; the input is unchanged. Enabling cloud or changing the allowed set
 * is a separate, higher-privilege change, not done here.
 */
export function setDefaultRuntimeProfile(
  config: SphereRuntimeConfig,
  newDefault: RuntimeProfile,
): SphereRuntimeConfig {
  assertProfileAllowed(config, newDefault);
  return { ...config, defaultProfile: newDefault };
}

/**
 * Resolve the profile to use for a turn. An agent's model preference overrides
 * only the model string on the Sphere's default provider — a "boring" swap that
 * never escalates provider or execution class (coding principle 9, RFC-004).
 */
export function resolveEffectiveProfile(
  config: SphereRuntimeConfig,
  agentModelPreference?: string,
): RuntimeProfile {
  const base = config.defaultProfile;
  if (agentModelPreference === undefined || agentModelPreference.trim() === "") {
    return base;
  }
  return { ...base, model: agentModelPreference.trim() };
}
