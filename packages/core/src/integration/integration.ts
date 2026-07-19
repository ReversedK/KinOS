/**
 * Integration — a replaceable adapter that *implements* capabilities
 * (domain-model.md, integration-model.md). It never defines permissions, owns no
 * memory, decides no consent: enabling/disabling changes *how* capabilities run,
 * never *whether* they are allowed (that is the Policy Engine).
 *
 * Pure domain: no I/O, no provider SDK. The concrete provider/operation names
 * live in adapters + Capability Bindings, not here; this entity holds the
 * governance-relevant facts (provider id, scopes, secret *reference*, status).
 *
 * Created `proposed` (deny by default): an integration is unavailable until a
 * governed enable. Secrets live in the secret store; only a reference is held.
 */

/** Lifecycle mirrors the capability binding lifecycle (entity-lifecycle.md). */
export type IntegrationStatus = "proposed" | "enabled" | "disabled" | "removed";

export interface Integration {
  readonly id: string;
  readonly sphereId: string;
  /** Adapter family (e.g. "google", "caldav", "mcp:minecraft"). Not a domain rule. */
  readonly provider: string;
  /**
   * The providers this integration MAY be backed by (RFC-034), from the package
   * manifest — the admin picks one via integration.configure. Optional: an
   * integration with no choices is fixed to its `provider`.
   */
  readonly providerChoices?: readonly string[];
  /** Minimal scopes the integration requests; visible to administrators. */
  readonly scopes: readonly string[];
  /** Secret-store reference for credentials — never the secret value. */
  readonly secretRef?: string;
  /** Capability names this integration can back (the agent-facing surface). */
  readonly providesCapabilities: readonly string[];
  /** How it authorizes (RFC-018): `oauth` → connect via the broker; `apikey` → a secret reference. */
  readonly auth?: "oauth" | "apikey";
  readonly status: IntegrationStatus;
}

export interface CreateIntegrationInput {
  readonly id: string;
  readonly sphereId: string;
  readonly provider: string;
  readonly providerChoices?: readonly string[];
  readonly scopes?: readonly string[];
  readonly secretRef?: string;
  readonly providesCapabilities?: readonly string[];
  readonly auth?: "oauth" | "apikey";
}

export function createIntegration(input: CreateIntegrationInput): Integration {
  const provider = input.provider.trim();
  if (provider.length === 0) {
    throw new Error("Integration provider must not be empty");
  }
  return {
    id: input.id,
    sphereId: input.sphereId,
    provider,
    ...(input.providerChoices !== undefined ? { providerChoices: [...input.providerChoices] } : {}),
    scopes: input.scopes ? [...input.scopes] : [],
    ...(input.secretRef !== undefined ? { secretRef: input.secretRef } : {}),
    providesCapabilities: input.providesCapabilities ? [...input.providesCapabilities] : [],
    ...(input.auth !== undefined ? { auth: input.auth } : {}),
    status: "proposed",
  };
}

/** Enable an integration (governed action). A removed integration cannot return. */
export function enableIntegration(integration: Integration): Integration {
  if (integration.status === "removed") {
    throw new Error("A removed integration cannot be re-enabled");
  }
  return { ...integration, status: "enabled" };
}

/** Disable an integration: future capability calls resolving to it are denied. */
export function disableIntegration(integration: Integration): Integration {
  if (integration.status === "removed") {
    throw new Error("A removed integration cannot be disabled");
  }
  return { ...integration, status: "disabled" };
}

/** Remove an integration. Blocks the future; audit history remains elsewhere. */
export function removeIntegration(integration: Integration): Integration {
  return { ...integration, status: "removed" };
}

/** Update the requested scopes (a governed, auditable binding change). */
export function updateScopes(integration: Integration, scopes: readonly string[]): Integration {
  return { ...integration, scopes: [...scopes] };
}

export function isActive(integration: Integration): boolean {
  return integration.status === "enabled";
}
