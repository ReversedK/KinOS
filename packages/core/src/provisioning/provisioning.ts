/**
 * Governed provisioning: capabilities, bindings and the bootstrap / admin-seed
 * policy sets (RFC-008).
 *
 * Provisioning (`sphere.create`, `member.invite`, `agent.create`,
 * `agent.update_config`) runs through the *same* governed pipeline as any other
 * capability: the per-call policy double-check + approval flow, then a
 * Capability Binding to a concrete local-executor tool whose side effect mutates
 * the SphereStore (the RFC-007 pattern). Nothing here skips `evaluate()`.
 *
 * Two explicit policy sets make provisioning authorizable without inverting
 * deny-by-default:
 *   - the **bootstrap** set authorizes `sphere.create` at the instance boundary
 *     (no Sphere/policy exists yet — the local operator is the root of trust);
 *   - the **default admin seed** is installed into a new Sphere so its
 *     administrators (and only they) can provision within it.
 *
 * Pure domain: no I/O, no provider/runtime imports. Tool names are an executor
 * detail; binding a capability to a tool name is domain config.
 */

import type { CapabilityBinding } from "../capability/types.js";
import type { Policy } from "../policy/types.js";
import type { Role } from "../sphere/member.js";

/** capability name -> executor tool name (an adapter implements the tool). */
export const PROVISIONING_TOOLS = {
  "sphere.create": "provisioning.create_sphere",
  "member.invite": "provisioning.invite_member",
  "agent.create": "provisioning.create_agent",
  "agent.update_config": "provisioning.update_agent",
  "policy.manage": "provisioning.manage_policy",
  "sphere.export": "provisioning.export_sphere",
} as const;

export type ProvisioningCapability = keyof typeof PROVISIONING_TOOLS;

/**
 * Per-capability binding risk. Provisioning is `high` by default; `sphere.export`
 * is `critical` to match its catalog entry (RFC-021), so a policy selecting on
 * `riskLevels` sees the same risk the catalog states. The catalog's approval floor
 * is what forces approval — this only keeps the two descriptions honest.
 */
const PROVISIONING_RISK: Partial<Record<ProvisioningCapability, CapabilityBinding["risk"]>> = {
  "sphere.export": "critical",
};

/** The in-Sphere provisioning capabilities (everything except bootstrap create). */
export const IN_SPHERE_PROVISIONING_CAPABILITIES: readonly ProvisioningCapability[] = [
  "member.invite",
  "agent.create",
  "agent.update_config",
  "policy.manage",
];

/** Runtime-governance capabilities administrators may invoke inside a Sphere. */
export const IN_SPHERE_RUNTIME_GOVERNANCE_CAPABILITIES = [
  "runtime.config.project",
  "runtime.session.backup",
  "runtime.session.restore",
  "runtime.session.attach",
] as const;

/**
 * The Sphere-settings capabilities administrators may invoke: the inference
 * provider/model (RFC-004), connectors, and store packages (RFC-002). Each is a
 * catalog capability the router already policy-checks; without a seed granting
 * them, deny-by-default left an administrator unable to administer these aspects
 * of their own Sphere. Granting them here does not weaken anything: the per-call
 * policy check, the adult-only catalog profile floor, and the cloud/consent path
 * on a cloud provider all still apply.
 */
export const IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES = [
  "runtime.set_provider",
  "integration.enable",
  "integration.disable",
  "integration.configure",
  "integration.oauth.begin",
  "package.install",
  "package.enable",
  "package.disable",
  // RFC-021: exporting the Sphere for backup/restore. The allow granted here is
  // raised to require_approval by the catalog's approval floor, and the core's
  // no-self-approval rule means one administrator can never unilaterally export a
  // Sphere containing another member's private memory.
  "sphere.export",
] as const;

/** The default administrator roles that the admin seed grants provisioning to. */
export const DEFAULT_ADMIN_ROLES: readonly Role[] = ["parent"];

/** The default enabled bindings for the provisioning capabilities. */
export function provisioningBindings(): CapabilityBinding[] {
  return (Object.entries(PROVISIONING_TOOLS) as [ProvisioningCapability, string][]).map(
    ([capability, runtimeToolName]) => ({
      capability,
      runtime: "local",
      runtimeToolName,
      execution: "local",
      risk: PROVISIONING_RISK[capability] ?? "high",
      requiresApproval: false, // policy governs; the catalog carries any floor
      status: "enabled",
    }),
  );
}

/**
 * The instance **bootstrap** policy set: authorizes exactly `sphere.create` for
 * an adult subject, and nothing else. `sphere.create` is instance-scoped (there
 * is no Sphere to key a policy to yet), so the execute path evaluates it against
 * this set rather than a Sphere's policies. Deny-by-default is preserved — the
 * only thing bootstrap trust can do is bring a Sphere into existence.
 *
 * `sphereId` is a synthetic instance scope tag; the engine does not key on it
 * for this evaluation (there is no Sphere resource yet).
 */
export function bootstrapPolicies(sphereId = "__instance__"): Policy[] {
  return [
    {
      id: "pol_bootstrap_sphere_create",
      sphereId,
      description: "An adult local operator may create a Sphere (bootstrap).",
      subjectSelector: { ageProfiles: ["adult"] },
      action: "execute",
      resourceSelector: { capabilityNames: ["sphere.create"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
  ];
}

/**
 * The default **administrative** policy set seeded into a new Sphere so its
 * administrators can provision (invite members, deploy/update agents) without a
 * prior manual policy. These are ordinary versioned, editable policies — a seed,
 * not a hidden privilege. Removing them removes the ability (deny-by-default).
 */
export function defaultAdminPolicies(
  sphereId: string,
  adminRoles: readonly Role[] = DEFAULT_ADMIN_ROLES,
): Policy[] {
  return [
    {
      id: `pol_${sphereId}_admin_provisioning`,
      sphereId,
      description: "Administrators may manage members, agents, and Sphere policies.",
      subjectSelector: { roles: [...adminRoles] },
      action: "execute",
      resourceSelector: {
        capabilityNames: [...IN_SPHERE_PROVISIONING_CAPABILITIES],
      },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
    {
      id: `pol_${sphereId}_admin_runtime_governance`,
      sphereId,
      description: "Administrators may project, back up, and restore agent runtime state.",
      subjectSelector: { roles: [...adminRoles] },
      action: "execute",
      resourceSelector: {
        capabilityNames: [...IN_SPHERE_RUNTIME_GOVERNANCE_CAPABILITIES],
      },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
    {
      // RFC-004/RFC-002: administrators may change the Sphere's inference
      // provider/model and manage connectors and store packages. Without this
      // seed an administrator was denied by default on their own Sphere's
      // settings. Selecting a cloud provider still engages the external-transfer
      // / consent path, and every call is still policy-checked per call.
      id: `pol_${sphereId}_admin_settings`,
      sphereId,
      description: "Administrators may manage Sphere settings: inference provider/model, connectors, and packages.",
      subjectSelector: { roles: [...adminRoles] },
      action: "execute",
      resourceSelector: {
        capabilityNames: [...IN_SPHERE_ADMIN_SETTINGS_CAPABILITIES],
      },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
    {
      // RFC-009: administrators (the founder/owner is one) may set an agent's
      // default model. A seed, not a hidden privilege — remove it and the
      // ability goes with it (deny-by-default). Narrow to specific administrator
      // member-ids by editing subjectSelector.
      id: `pol_${sphereId}_admin_model`,
      sphereId,
      description: "Administrators may set an agent's default model.",
      subjectSelector: { roles: [...adminRoles] },
      action: "execute",
      resourceSelector: { capabilityNames: ["model.set"] },
      effect: "allow",
      priority: 0,
      version: 1,
      status: "active",
    },
  ];
}
