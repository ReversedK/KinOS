/**
 * Policy Engine types — ADR-003.
 *
 * The Policy Engine is the single authority for authorization. These types are
 * pure domain vocabulary: no provider/runtime imports, no I/O.
 */

export type AgeProfile = "adult" | "teen" | "child";

export type PolicyAction =
  | "read"
  | "write"
  | "share"
  | "revoke"
  | "execute"
  | "approve"
  | "export"
  | "enable"
  | "disable";

export type ResourceType =
  | "memory"
  | "capability"
  | "integration"
  | "document"
  | "sphere"
  | "approval";

export type Classification =
  | "private"
  | "shared_with_members"
  | "shared_with_supervisors"
  | "shared_with_sphere"
  | "public_exportable";

export type Sensitivity = "normal" | "sensitive" | "medical" | "financial" | "legal";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Effect = "allow" | "deny" | "require_approval";

export interface PolicyRequest {
  readonly subject: {
    readonly memberId?: string;
    readonly agentId?: string;
    /** Role in this Sphere: parent | teenager | child | guest | admin | … */
    readonly role: string;
    readonly ageProfile: AgeProfile;
    readonly onBehalfOf?: string;
  };
  readonly action: PolicyAction;
  readonly resource: {
    readonly type: ResourceType;
    readonly id?: string;
    readonly classification?: Classification;
    readonly sensitivity?: Sensitivity;
    readonly capabilityName?: string;
    readonly riskLevel?: RiskLevel;
  };
  readonly context: {
    readonly sphereId: string;
    /** ISO timestamp; the wall-clock time is used for time-window conditions. */
    readonly time: string;
    readonly execution: "local" | "cloud";
    readonly estimatedCostCents?: number;
    readonly correlationId: string;
  };
}

export interface PolicyDecision {
  readonly effect: Effect;
  /** User-safe reason; references the deciding policy where one matched. */
  readonly reason: string;
  readonly matchedPolicyId?: string;
  readonly matchedPolicyVersion?: number;
  readonly approval?: {
    readonly approverRoles: readonly string[];
    readonly expiresInSeconds: number;
  };
  readonly correlationId: string;
}

export interface TimeWindow {
  /** Local HH:MM; the window starts at/after this time. */
  readonly after?: string;
  /** Local HH:MM; the window ends strictly before this time. */
  readonly before?: string;
}

export interface Policy {
  readonly id: string;
  readonly sphereId: string;
  readonly description: string;
  readonly subjectSelector: {
    readonly roles?: readonly string[];
    readonly ageProfiles?: readonly AgeProfile[];
    readonly memberIds?: readonly string[];
    /** Agent kind selector. Not yet evaluated (see engine.ts); deferred. */
    readonly agents?: "personal" | "sphere" | "any";
  };
  readonly action: PolicyAction | "any";
  readonly resourceSelector: {
    readonly types?: readonly ResourceType[];
    /** Exact names or prefix patterns, e.g. "message.*". */
    readonly capabilityNames?: readonly string[];
    readonly classifications?: readonly Classification[];
    readonly sensitivities?: readonly Sensitivity[];
    readonly riskLevels?: readonly RiskLevel[];
  };
  readonly contextConditions?: {
    readonly timeWindows?: readonly TimeWindow[];
    readonly execution?: "local" | "cloud";
    readonly maxCostCents?: number;
  };
  readonly effect: Effect;
  readonly approverRoles?: readonly string[];
  readonly priority: number;
  readonly version: number;
  readonly status: "draft" | "test" | "active" | "disabled" | "superseded" | "archived";
}

/** Default expiry for an approval requirement when a policy does not set one. */
export const DEFAULT_APPROVAL_EXPIRY_SECONDS = 3600;
