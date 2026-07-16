/**
 * KinOS read API router (api-contract.md).
 *
 * Transport-agnostic: a pure async function from a parsed request to an
 * ApiResponse. Every response carries a correlation id (generated at entry),
 * matching the cross-cutting request semantics. This MVP slice exposes
 * read-only metadata endpoints (the substrate the UI consumes); governed
 * capability requests go through the core pipeline, not handler logic.
 *
 * The router decides no authorization the Policy Engine could not reproduce; it
 * only surfaces already-governed state (coding principle 1).
 */

import {
  ageProfileForRole,
  assertProfileAllowed,
  beginSensitiveAction,
  changeModelPreference,
  bootstrapPolicies,
  createRuntimeProfile,
  createSession,
  createTuiTicket,
  defaultCapabilityCatalog,
  defaultAdminPolicies,
  defaultStoreCatalog,
  disableIntegration,
  disablePackage,
  enableIntegration,
  enablePackage,
  evaluate,
  exportSphere,
  importSphere,
  installPackage,
  projectAgentRuntimeConfig,
  provisioningBindings,
  resolveInstallPlan,
  runtimeGovernanceBindings,
  authorizeSessionRead,
  resolveApproval,
  resolveEffectiveProfile,
  runChatTurn,
  setDefaultRuntimeProfile,
  type AgentRuntime,
  type ApprovalStore,
  type AuditReader,
  type AuditSink,
  type CapabilityExecutionRequest,
  type CapabilityExecutor,
  type PolicyRequest,
  type Role,
  type RuntimeExecution,
  type RuntimeProviderId,
  type SessionStore,
  type SphereStore,
  type TuiTicketStore,
} from "@kinos/core";

export interface ApiDeps {
  readonly store: SphereStore;
  readonly approvals: ApprovalStore;
  readonly audit: AuditReader;
  readonly newCorrelationId: () => string;
  /** Write path (governed capability execution). Absent → execution disabled. */
  readonly executor?: CapabilityExecutor;
  readonly auditSink?: AuditSink;
  readonly newApprovalId?: () => string;
  /** Chat sessions (RFC-005). Absent → chat endpoints disabled. */
  readonly sessions?: SessionStore;
  readonly newSessionId?: () => string;
  /** Agent runtime for chat turns. Absent → the turn endpoint is disabled. */
  readonly runtime?: AgentRuntime;
  /**
   * Single-use tickets for attaching a terminal to an agent's governed Harness
   * profile (ADR-008 §6). Absent → the Harness terminal is disabled entirely
   * (deny by default: no store, no attach).
   */
  readonly tuiTickets?: TuiTicketStore;
  /** Mints a ticket value; the app layer supplies a CSPRNG. */
  readonly newTuiTicket?: () => string;
  /** Injectable clock for the execution context; defaults to wall-clock. */
  readonly now?: () => string;
}

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  /** Parsed JSON body for write requests. */
  readonly body?: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly correlationId: string;
  readonly body: unknown;
  readonly code?: string;
}

export async function handleApiRequest(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const correlationId = deps.newCorrelationId();
  const ok = (body: unknown): ApiResponse => ({ status: 200, correlationId, body });
  const err = (status: number, code: string, message: string): ApiResponse => ({
    status,
    correlationId,
    code,
    body: { code, message },
  });

  const segments = req.path.split("/").filter((s) => s.length > 0);
  /**
   * Backfill admin seed policies onto Spheres provisioned before a seed existed,
   * so an administrator is not locked out of their own Sphere by a seed set that
   * has grown since (RFC-008 seeds are ordinary policies, not hidden privilege).
   *
   * Anchored on seed lineage, never fabricating authority: the backfill applies
   * ONLY to a Sphere that still carries the `admin_provisioning` seed, proving it
   * was created by RFC-008 provisioning and merely predates the newer seeds. A
   * Sphere with no policies — or one whose admin seed was removed — is left
   * untouched and stays denied by default (invariant: deny by default; a missing
   * policy is never read as permission). Only *missing* seeds are added, nothing
   * is widened beyond today's seed, and every call is still policy-checked.
   */
  const withAdminSeedMigration = (
    sphereId: string,
    policies: ReturnType<typeof importSphere>["policies"],
    capabilityName = "runtime.config.project",
  ) => {
    const seeded = policies.some((p) => p.id === `pol_${sphereId}_admin_provisioning`);
    const missing = seeded
      ? defaultAdminPolicies(sphereId).filter((seed) => !policies.some((p) => p.id === seed.id))
      : [];
    let migrated = [...policies, ...missing];
    if (capabilityName === "policy.manage") {
      const id = `pol_${sphereId}_admin_provisioning`;
      migrated = migrated.map((policy) =>
        policy.id === id && policy.version === 1 && !policy.resourceSelector.capabilityNames?.includes("policy.manage")
          ? {
              ...policy,
              resourceSelector: {
                ...policy.resourceSelector,
                capabilityNames: [...(policy.resourceSelector.capabilityNames ?? []), "policy.manage"],
              },
            }
          : policy,
      );
    }
    return migrated;
  };

  // --- Governed provisioning: create a Sphere (RFC-008, api-contract §Sphere) ---
  // POST /spheres  { subject, input: { name, type?, founderName?, founderRole? } }
  //
  // Instance-scoped bootstrap: `sphere.create` is evaluated against the fixed
  // bootstrap policy set (the local operator is the root of trust for an empty
  // instance), not any Sphere's policies. The side effect generates the Sphere
  // id, records the founder as first administrator and seeds the default admin
  // policy set (RFC-008). Deny-by-default is preserved — bootstrap grants only
  // `sphere.create`.
  if (req.method === "POST" && segments[0] === "spheres" && segments.length === 1) {
    if (deps.executor === undefined || deps.auditSink === undefined || deps.newApprovalId === undefined) {
      return err(501, "invalid_request", "Provisioning is not enabled on this server");
    }
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: CapabilityExecutionRequest["subject"];
      input?: unknown;
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    const request: CapabilityExecutionRequest = {
      subject,
      capabilityName: "sphere.create",
      // The side effect generates the Sphere id; the pipeline runs at instance
      // scope. The correlation id chains the bootstrap check to sphere.created.
      input: {
        ...(typeof body.input === "object" && body.input !== null ? body.input : {}),
        correlationId,
      },
      context: {
        sphereId: "__instance__",
        time: (deps.now ?? (() => new Date().toISOString()))(),
        execution: "local",
        correlationId,
      },
    };
    let result;
    try {
      result = await beginSensitiveAction(request, {
        catalog: defaultCapabilityCatalog(),
        bindings: provisioningBindings(),
        policies: bootstrapPolicies(),
        executor: deps.executor,
        audit: deps.auditSink,
        newApprovalId: deps.newApprovalId,
      });
    } catch (e) {
      // An authorized side effect that fails (e.g. invalid input) is a governed
      // execution failure, not a server error — surface it as a 422.
      return err(422, "execution_failed", (e as Error).message);
    }
    if (result.status === "pending_approval" && result.approval !== undefined) {
      await deps.approvals.save({ approval: result.approval, request });
      return {
        status: 202,
        correlationId,
        code: "approval_required",
        body: {
          status: result.status,
          reason: result.reason,
          approvalId: result.approval.id,
          approverRoles: result.approval.approverRoles,
        },
      };
    }
    if (result.status === "denied") {
      return err(403, "forbidden", result.reason);
    }
    return ok({
      status: result.status,
      reason: result.reason,
      ...(result.output !== undefined ? { output: result.output } : {}),
    });
  }

  // --- Governed write path: request capability execution (api-contract §Capability) ---
  // POST /spheres/:id/capabilities/:name/execute
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 5 &&
    segments[2] === "capabilities" &&
    segments[4] === "execute"
  ) {
    if (deps.executor === undefined || deps.auditSink === undefined || deps.newApprovalId === undefined) {
      return err(501, "invalid_request", "Capability execution is not enabled on this server");
    }
    const sphereId = segments[1] as string;
    const capabilityName = decodeURIComponent(segments[3] as string);
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: CapabilityExecutionRequest["subject"];
      input?: unknown;
      execution?: "local" | "cloud";
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }

    const imported = importSphere(snap);
    const effectivePolicies = capabilityName === "runtime.config.project" || capabilityName === "policy.manage"
      ? withAdminSeedMigration(sphereId, imported.policies, capabilityName)
      : imported.policies;
    const request: CapabilityExecutionRequest = {
      subject,
      capabilityName,
      // The path Sphere and correlation id are authoritative for the executor
      // side effect (integrity: a client cannot provision into another Sphere);
      // path values win over any client-supplied ones.
      input: {
        ...(typeof body.input === "object" && body.input !== null ? body.input : {}),
        sphereId,
        correlationId,
      },
      context: {
        sphereId,
        time: (deps.now ?? (() => new Date().toISOString()))(),
        execution: body.execution === "cloud" ? "cloud" : "local",
        correlationId,
      },
    };

    let result;
    try {
      result = await beginSensitiveAction(request, {
        catalog: defaultCapabilityCatalog(),
        // Runtime-governance capabilities (RFC-007) and provisioning capabilities
        // (RFC-008) bind to the local executor's runtime.*/provisioning.* tools;
        // add their bindings so they run through this same governed pipeline.
        bindings: [...imported.bindings, ...runtimeGovernanceBindings(), ...provisioningBindings()],
        policies: effectivePolicies,
        executor: deps.executor,
        audit: deps.auditSink,
        newApprovalId: deps.newApprovalId,
      });
    } catch (e) {
      return err(422, "execution_failed", (e as Error).message);
    }

    if (result.status === "pending_approval" && result.approval !== undefined) {
      await deps.approvals.save({ approval: result.approval, request });
      return {
        status: 202,
        correlationId,
        code: "approval_required",
        body: {
          status: result.status,
          reason: result.reason,
          approvalId: result.approval.id,
          approverRoles: result.approval.approverRoles,
        },
      };
    }
    if (result.status === "denied") {
      return err(403, "forbidden", result.reason);
    }
    return ok({
      status: result.status,
      reason: result.reason,
      ...(result.output !== undefined ? { output: result.output } : {}),
    });
  }

  // --- Governed write path: resolve an approval (api-contract §Approval) ---
  // POST /approvals/:id/grant | /approvals/:id/deny
  if (
    req.method === "POST" &&
    segments[0] === "approvals" &&
    segments.length === 3 &&
    (segments[2] === "grant" || segments[2] === "deny")
  ) {
    if (deps.executor === undefined || deps.auditSink === undefined) {
      return err(501, "invalid_request", "Approval resolution is not enabled on this server");
    }
    const approvalId = segments[1] as string;
    const decision = segments[2] === "grant" ? "grant" : "deny";

    const pending = await deps.approvals.load(approvalId);
    if (pending === undefined) return err(404, "not_found", "Approval not found");
    if (pending.approval.state !== "pending") {
      return err(409, "invalid_request", `Approval is already ${pending.approval.state}`);
    }

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      approver?: { memberId?: string; role?: string };
    };
    const approver = body.approver;
    if (approver === undefined || typeof approver.memberId !== "string" || typeof approver.role !== "string") {
      return err(400, "invalid_request", "An approver with memberId and role is required");
    }

    const snap = await deps.store.load(pending.approval.sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const imported = importSphere(snap);

    let result;
    try {
      result = await resolveApproval(
        pending.approval,
        {
          approver: {
            memberId: approver.memberId,
            roles: [approver.role],
            ageProfile: ageProfileForRole(approver.role as Role),
          },
          decision,
          at: (deps.now ?? (() => new Date().toISOString()))(),
        },
        pending.request,
        {
          catalog: defaultCapabilityCatalog(),
          bindings: [...imported.bindings, ...runtimeGovernanceBindings(), ...provisioningBindings()],
          // Same effective policy set the request was checked against when it was
          // suspended. Without the backfill an action could be authorized, wait
          // for approval, then be denied at grant time on a Sphere whose seed set
          // predates the capability — the approval would be unresolvable.
          policies: withAdminSeedMigration(
            pending.approval.sphereId,
            imported.policies,
            pending.request.capabilityName,
          ),
          executor: deps.executor,
          audit: deps.auditSink,
          newApprovalId: () => approvalId,
        },
      );
    } catch (e) {
      return err(422, "execution_failed", (e as Error).message);
    }

    if (result.approval !== undefined) {
      await deps.approvals.save({ approval: result.approval, request: pending.request });
    }
    return ok({
      approvalId,
      capability: pending.approval.action.capabilityName,
      status: result.status,
      reason: result.reason,
      ...(result.output !== undefined ? { output: result.output } : {}),
    });
  }

  // --- Governed settings write: set the Sphere's inference provider/model (RFC-004) ---
  // POST /spheres/:id/runtime  { subject, profile }
  if (req.method === "POST" && segments[0] === "spheres" && segments.length === 3 && segments[2] === "runtime") {
    if (deps.auditSink === undefined) {
      return err(501, "invalid_request", "Runtime configuration is not enabled on this server");
    }
    const sphereId = segments[1] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
      profile?: { providerId?: string; model?: string; execution?: string; baseUrl?: string; secretRef?: string };
    };
    const subject = body.subject;
    const p = body.profile;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    if (p === undefined || typeof p.providerId !== "string" || typeof p.model !== "string" || typeof p.execution !== "string") {
      return err(400, "invalid_request", "A profile with providerId, model and execution is required");
    }

    const imported = importSphere(snap);
    const stamp = (deps.now ?? (() => new Date().toISOString()))();

    // Catalog profile floor: minors can never set the provider (deny by default).
    const cap = defaultCapabilityCatalog().get("runtime.set_provider");
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", "runtime.set_provider is not allowed for this profile");
    }

    // Policy Engine decides (the router asserts no authorization the engine couldn't).
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName: "runtime.set_provider", riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, imported.policies, "runtime.set_provider"),
    );
    if (decision.effect !== "allow") {
      deps.auditSink.record({
        type: "capability.denied",
        sphereId,
        resourceType: "capability",
        resourceId: "runtime.set_provider",
        decision: "deny",
        reason: decision.reason,
        correlationId,
        createdAt: stamp,
        ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
        ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
        ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
      });
      return err(403, "forbidden", decision.reason);
    }

    let newProfile;
    try {
      newProfile = createRuntimeProfile({
        providerId: p.providerId as RuntimeProviderId,
        model: p.model,
        execution: p.execution as RuntimeExecution,
        ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
        ...(p.secretRef !== undefined ? { secretRef: p.secretRef } : {}),
      });
    } catch (e) {
      return err(400, "invalid_request", (e as Error).message);
    }

    let newConfig;
    try {
      newConfig = setDefaultRuntimeProfile(imported.runtimeConfig, newProfile);
    } catch (e) {
      // Deny-by-default: cannot switch to a disallowed provider / cloud-while-disabled.
      return err(403, "forbidden", (e as Error).message);
    }

    await deps.store.save(exportSphere({ ...imported, runtimeConfig: newConfig, exportedAt: stamp }));
    deps.auditSink.record({
      type: "capability.executed",
      sphereId,
      resourceType: "capability",
      resourceId: "runtime.set_provider",
      decision: "executed",
      reason: `provider=${newProfile.providerId} model=${newProfile.model}`,
      correlationId,
      createdAt: stamp,
      ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
      ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
    });
    return ok({ status: "executed", provider: newProfile.providerId, model: newProfile.model, execution: newProfile.execution });
  }

  // --- Governed per-agent default model (RFC-009) ---
  // POST /spheres/:id/agents/:aid/model  { subject, model }
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 5 &&
    segments[2] === "agents" &&
    segments[4] === "model"
  ) {
    if (deps.auditSink === undefined) {
      return err(501, "invalid_request", "Model configuration is not enabled on this server");
    }
    const sphereId = segments[1] as string;
    const agentId = segments[3] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
      model?: string;
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    if (typeof body.model !== "string" || body.model.trim() === "") {
      return err(400, "invalid_request", "A non-empty model is required");
    }
    const model = body.model.trim();

    const imported = importSphere(snap);
    const agent = imported.agents.find((a) => a.id === agentId);
    if (agent === undefined) return err(404, "not_found", "Agent not found");
    const stamp = (deps.now ?? (() => new Date().toISOString()))();

    // Catalog profile floor: minors can never set a model (deny by default).
    const cap = defaultCapabilityCatalog().get("model.set");
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", "model.set is not allowed for this profile");
    }

    // Policy Engine decides — the router asserts no authorization the engine couldn't.
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName: "model.set", riskLevel: "medium" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, imported.policies, "model.set"),
    );
    if (decision.effect !== "allow") {
      deps.auditSink.record({
        type: "capability.denied",
        sphereId,
        resourceType: "capability",
        resourceId: agentId,
        decision: "deny",
        reason: decision.reason,
        correlationId,
        createdAt: stamp,
        ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
        ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
        ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
      });
      return err(403, "forbidden", decision.reason);
    }

    // Deny-by-default: the resulting model must stay within the Sphere-allowed set
    // (the override only swaps the model on the Sphere's provider; provider/cloud
    // gating is unchanged and enforced here as defense in depth).
    try {
      assertProfileAllowed(imported.runtimeConfig, resolveEffectiveProfile(imported.runtimeConfig, model));
    } catch (e) {
      return err(403, "forbidden", (e as Error).message);
    }

    const updatedAgent = changeModelPreference(agent, model);
    const agents = imported.agents.map((a) => (a.id === agentId ? updatedAgent : a));
    await deps.store.save(exportSphere({ ...imported, agents, exportedAt: stamp }));
    deps.auditSink.record({
      type: "capability.executed",
      sphereId,
      resourceType: "capability",
      resourceId: agentId,
      decision: "executed",
      reason: `model=${model}`,
      correlationId,
      createdAt: stamp,
      ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
      ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
    });
    return ok({ status: "executed", agentId, model });
  }

  // --- Governed connectors: enable/disable an integration (integration-model) ---
  // POST /spheres/:id/integrations/:iid/enable | /disable
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 5 &&
    segments[2] === "integrations" &&
    (segments[4] === "enable" || segments[4] === "disable")
  ) {
    if (deps.auditSink === undefined) {
      return err(501, "invalid_request", "Integration management is not enabled on this server");
    }
    const sphereId = segments[1] as string;
    const integrationId = segments[3] as string;
    const action = segments[4] === "enable" ? "enable" : "disable";
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const imported = importSphere(snap);
    const integration = imported.integrations.find((i) => i.id === integrationId);
    if (integration === undefined) return err(404, "not_found", "Integration not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }

    const capabilityName = action === "enable" ? "integration.enable" : "integration.disable";
    const stamp = (deps.now ?? (() => new Date().toISOString()))();
    const cap = defaultCapabilityCatalog().get(capabilityName);
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", `${capabilityName} is not allowed for this profile`);
    }
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "integration", id: integrationId, capabilityName, riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, imported.policies, capabilityName),
    );
    if (decision.effect !== "allow") {
      return err(403, "forbidden", decision.reason);
    }

    let updated;
    try {
      updated = action === "enable" ? enableIntegration(integration) : disableIntegration(integration);
    } catch (e) {
      return err(409, "invalid_request", (e as Error).message);
    }
    const integrations = imported.integrations.map((i) => (i.id === integrationId ? updated : i));
    await deps.store.save(exportSphere({ ...imported, integrations, exportedAt: stamp }));
    deps.auditSink.record({
      type: action === "enable" ? "integration.enabled" : "integration.disabled",
      sphereId,
      resourceType: "integration",
      resourceId: integrationId,
      decision: "executed",
      reason: `${capabilityName} provider=${integration.provider}`,
      correlationId,
      createdAt: stamp,
      ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
      ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
    });
    return ok({ id: integrationId, status: updated.status });
  }

  // --- Store: install a package (RFC-002) ---
  // POST /spheres/:id/packages/install  { subject, packageId }
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 4 &&
    segments[2] === "packages" &&
    segments[3] === "install"
  ) {
    if (deps.auditSink === undefined) return err(501, "invalid_request", "Package management is not enabled on this server");
    const sphereId = segments[1] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const imported = importSphere(snap);
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
      packageId?: string;
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    if (typeof body.packageId !== "string") return err(400, "invalid_request", "packageId is required");

    const stamp = (deps.now ?? (() => new Date().toISOString()))();
    const cap = defaultCapabilityCatalog().get("package.install");
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", "package.install is not allowed for this profile");
    }
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName: "package.install", riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, imported.policies, "package.install"),
    );
    if (decision.effect !== "allow") return err(403, "forbidden", decision.reason);

    const installedIds = imported.packages.map((p) => p.manifest.id);
    if (installedIds.includes(body.packageId)) {
      return err(409, "invalid_request", "Package already installed");
    }
    // Resolve + dedup dependencies (RFC-002): install absent deps in order.
    let plan;
    try {
      plan = resolveInstallPlan(body.packageId, defaultStoreCatalog(), installedIds);
    } catch (e) {
      const msg = (e as Error).message;
      return /not found/i.test(msg) ? err(404, "not_found", msg) : err(409, "invalid_request", msg);
    }
    // Install != authorization: each package is `installed`; use is granted only by policy.
    const newPackages = plan.map((m) => installPackage(m, sphereId));
    await deps.store.save(exportSphere({ ...imported, packages: [...imported.packages, ...newPackages], exportedAt: stamp }));
    for (const m of plan) {
      deps.auditSink.record({
        type: "package.installed",
        sphereId,
        resourceType: "package",
        resourceId: m.id,
        decision: "executed",
        reason: `package.install type=${m.type}`,
        correlationId,
        createdAt: stamp,
        ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
        ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
        ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
      });
    }
    return ok({ id: body.packageId, status: "installed", installed: plan.map((m) => m.id) });
  }

  // POST /spheres/:id/packages/:pid/enable | /disable
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 5 &&
    segments[2] === "packages" &&
    (segments[4] === "enable" || segments[4] === "disable")
  ) {
    if (deps.auditSink === undefined) return err(501, "invalid_request", "Package management is not enabled on this server");
    const sphereId = segments[1] as string;
    const packageId = segments[3] as string;
    const action = segments[4] === "enable" ? "enable" : "disable";
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const imported = importSphere(snap);
    const pkg = imported.packages.find((p) => p.manifest.id === packageId);
    if (pkg === undefined) return err(404, "not_found", "Package not installed");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as { subject?: PolicyRequest["subject"] };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    const capabilityName = action === "enable" ? "package.enable" : "package.disable";
    const stamp = (deps.now ?? (() => new Date().toISOString()))();
    const cap = defaultCapabilityCatalog().get(capabilityName);
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", `${capabilityName} is not allowed for this profile`);
    }
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName, riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, imported.policies, capabilityName),
    );
    if (decision.effect !== "allow") return err(403, "forbidden", decision.reason);

    let updated;
    try {
      updated = action === "enable" ? enablePackage(pkg) : disablePackage(pkg);
    } catch (e) {
      return err(409, "invalid_request", (e as Error).message);
    }
    const packages = imported.packages.map((p) => (p.manifest.id === packageId ? updated : p));
    await deps.store.save(exportSphere({ ...imported, packages, exportedAt: stamp }));
    deps.auditSink.record({
      type: action === "enable" ? "package.enabled" : "package.disabled",
      sphereId,
      resourceType: "package",
      resourceId: packageId,
      decision: "executed",
      reason: capabilityName,
      correlationId,
      createdAt: stamp,
      ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
      ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
      ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
    });
    return ok({ id: packageId, status: updated.status });
  }

  // --- Chat: create a session (RFC-005) ---
  // POST /spheres/:id/sessions  { subject, agentId, title? }
  if (req.method === "POST" && segments[0] === "spheres" && segments.length === 3 && segments[2] === "sessions") {
    if (deps.sessions === undefined || deps.newSessionId === undefined) {
      return err(501, "invalid_request", "Chat sessions are not enabled on this server");
    }
    const sphereId = segments[1] as string;
    if ((await deps.store.load(sphereId)) === undefined) return err(404, "not_found", "Sphere not found");
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: { memberId?: string };
      agentId?: string;
      title?: string;
    };
    const ownerId = body.subject?.memberId;
    if (typeof ownerId !== "string" || typeof body.agentId !== "string") {
      return err(400, "invalid_request", "subject.memberId and agentId are required");
    }
    const session = createSession({
      id: deps.newSessionId(),
      sphereId,
      agentId: body.agentId,
      ownerId,
      now: (deps.now ?? (() => new Date().toISOString()))(),
      ...(body.title !== undefined ? { title: body.title } : {}),
    });
    await deps.sessions.save(session);
    return ok({ id: session.id, title: session.title, agentId: session.agentId, ownerId: session.ownerId, state: session.state });
  }

  // --- Chat: post a turn (RFC-005) ---
  // POST /spheres/:id/sessions/:sid/messages  { subject, text, systemPrompt? }
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 5 &&
    segments[2] === "sessions" &&
    segments[4] === "messages"
  ) {
    if (deps.sessions === undefined || deps.runtime === undefined) {
      return err(501, "invalid_request", "Chat is not enabled on this server");
    }
    const sphereId = segments[1] as string;
    const sessionId = segments[3] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const session = await deps.sessions.load(sessionId);
    if (session === undefined || session.sphereId !== sphereId) return err(404, "not_found", "Session not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
      text?: string;
      systemPrompt?: string;
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return err(400, "invalid_request", "A non-empty text is required");
    }

    const imported = importSphere(snap);
    // Honor the agent's governed default model (RFC-009): the session's agent
    // preference overrides the model within the Sphere-allowed set; unset falls
    // back to the Sphere default profile.
    const sessionAgent = imported.agents.find((a) => a.id === session.agentId);
    const model = resolveEffectiveProfile(imported.runtimeConfig, sessionAgent?.modelPreference).model;
    const stamp = (deps.now ?? (() => new Date().toISOString()))();

    // Authorization is decided here, before the runtime — a non-owner subject is
    // refused (owner-private, deny by default). Checked explicitly so a genuine
    // 403 is never conflated with a runtime execution failure below, which must
    // surface truthfully instead of masquerading as "not authorized".
    if (
      authorizeSessionRead(subject, session, imported.policies, {
        sphereId,
        time: stamp,
        correlationId,
      }).effect !== "allow"
    ) {
      return err(403, "forbidden", "Not authorized for this session");
    }

    let result;
    try {
      result = await runChatTurn(
        { runtime: deps.runtime },
        {
          session,
          subject,
          userText: body.text,
          memory: imported.memory,
          policies: imported.policies,
          model,
          now: stamp,
          correlationId,
          userMessageId: `${correlationId}-u`,
          agentMessageId: `${correlationId}-a`,
          ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
        },
      );
    } catch (e) {
      // Authorization already passed above, so a throw here is the runtime
      // failing (e.g. Ollama/Hermes unreachable or the model not pulled). Report
      // it as an upstream failure with the real reason, not as a 403.
      return err(502, "runtime_error", `Agent runtime failed: ${(e as Error).message}`);
    }

    await deps.sessions.save(result.session);
    return ok({ sessionId, reply: result.reply, messageCount: result.session.messages.length });
  }

  // --- RFC-007/ADR-007: preview an agent's governed runtime config projection ---
  // POST /spheres/:id/agents/:aid/runtime/tui  { subject }
  // Mint a single-use ticket authorizing a terminal attach to the agent's
  // governed Harness profile (ADR-008 §6). This endpoint is the authorization
  // boundary: the Harness-side bridge only redeems, it never decides.
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 6 &&
    segments[2] === "agents" &&
    segments[4] === "runtime" &&
    segments[5] === "tui"
  ) {
    if (deps.tuiTickets === undefined || deps.newTuiTicket === undefined || deps.auditSink === undefined) {
      return err(501, "not_implemented", "The Harness terminal is not enabled on this deployment");
    }
    const sphereId = segments[1] as string;
    const agentId = segments[3] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    if (snap.agents.find((a) => a.id === agentId) === undefined) return err(404, "not_found", "Agent not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }

    const stamp = (deps.now ?? (() => new Date().toISOString()))();
    const cap = defaultCapabilityCatalog().get("runtime.session.attach");
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", "runtime.session.attach is not allowed for this profile");
    }
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName: "runtime.session.attach", riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      withAdminSeedMigration(sphereId, importSphere(snap).policies, "runtime.session.attach"),
    );
    if (decision.effect !== "allow") {
      deps.auditSink.record({
        type: "capability.denied",
        sphereId,
        agentId,
        resourceType: "capability",
        resourceId: "runtime.session.attach",
        decision: "deny",
        reason: decision.reason,
        correlationId,
        createdAt: stamp,
        ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
        ...(decision.matchedPolicyId !== undefined ? { policyId: decision.matchedPolicyId } : {}),
        ...(decision.matchedPolicyVersion !== undefined ? { policyVersion: decision.matchedPolicyVersion } : {}),
      });
      return err(403, "forbidden", decision.reason);
    }

    const ticket = createTuiTicket({
      value: deps.newTuiTicket(),
      sphereId,
      agentId,
      correlationId,
      now: stamp,
    });
    deps.tuiTickets.issue(ticket);
    // Security fact only: that an attach was authorized, never the ticket value.
    deps.auditSink.record({
      type: "capability.executed",
      sphereId,
      agentId,
      resourceType: "capability",
      resourceId: "runtime.session.attach",
      decision: "executed",
      reason: "harness terminal attach authorized",
      correlationId,
      createdAt: stamp,
      ...(subject.memberId !== undefined ? { actorId: subject.memberId } : {}),
    });
    return ok({ status: "executed", ticket: ticket.value, expiresAt: ticket.expiresAt, agentId, correlationId });
  }

  // POST /tui/redeem  { ticket }
  // Redeemed by the Harness-side bridge, which presents a ticket and is told
  // which profile it may open. It receives an agent id, never a filesystem path,
  // and no authorization is computed here — the decision already happened at
  // mint time (ADR-008 §5: the Harness is never the governance boundary).
  if (req.method === "POST" && segments.length === 2 && segments[0] === "tui" && segments[1] === "redeem") {
    if (deps.tuiTickets === undefined || deps.auditSink === undefined) {
      return err(501, "not_implemented", "The Harness terminal is not enabled on this deployment");
    }
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as { ticket?: unknown };
    if (typeof body.ticket !== "string" || body.ticket === "") {
      return err(400, "invalid_request", "A ticket is required");
    }
    const redeemed = deps.tuiTickets.redeem(body.ticket);
    // Unknown, expired or replayed all look identical from outside — a refusal
    // must not tell an attacker which of the three it was.
    if (redeemed === undefined) return err(403, "forbidden", "Invalid or expired ticket");
    deps.auditSink.record({
      type: "runtime.session.attached",
      sphereId: redeemed.sphereId,
      agentId: redeemed.agentId,
      resourceType: "agent",
      resourceId: redeemed.agentId,
      decision: "executed",
      reason: "harness terminal attached",
      correlationId: redeemed.correlationId,
      createdAt: (deps.now ?? (() => new Date().toISOString()))(),
    });
    return ok({ agentId: redeemed.agentId, sphereId: redeemed.sphereId, correlationId: redeemed.correlationId });
  }

  // POST /spheres/:id/agents/:aid/runtime/projection  { subject }
  // Read/compute only (no mutation, no token minted) — the exact governed config
  // that would be written to the agent's runtime profile. Admin-gated.
  if (
    req.method === "POST" &&
    segments[0] === "spheres" &&
    segments.length === 6 &&
    segments[2] === "agents" &&
    segments[4] === "runtime" &&
    segments[5] === "projection"
  ) {
    const sphereId = segments[1] as string;
    const agentId = segments[3] as string;
    const snap = await deps.store.load(sphereId);
    if (snap === undefined) return err(404, "not_found", "Sphere not found");
    const agent = snap.agents.find((a) => a.id === agentId);
    if (agent === undefined) return err(404, "not_found", "Agent not found");

    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as {
      subject?: PolicyRequest["subject"];
    };
    const subject = body.subject;
    if (subject === undefined || typeof subject.role !== "string" || typeof subject.ageProfile !== "string") {
      return err(400, "invalid_request", "A subject with role and ageProfile is required");
    }

    const stamp = (deps.now ?? (() => new Date().toISOString()))();
    // Admin floor + policy: previewing a projection is gated like runtime.config.project.
    const cap = defaultCapabilityCatalog().get("runtime.config.project");
    if (cap === undefined || !cap.allowedProfiles.includes(subject.ageProfile)) {
      return err(403, "forbidden", "runtime.config.project is not allowed for this profile");
    }
    const effectivePolicies = withAdminSeedMigration(sphereId, importSphere(snap).policies);
    const decision = evaluate(
      {
        subject,
        action: "execute",
        resource: { type: "capability", capabilityName: "runtime.config.project", riskLevel: "high" },
        context: { sphereId, time: stamp, execution: "local", correlationId },
      },
      effectivePolicies,
    );
    if (decision.effect !== "allow") return err(403, "forbidden", decision.reason);

    const imported = importSphere(snap);
    // The projection is computed for the AGENT's own identity (owner-derived),
    // not the admin caller — two agents project different authorized surfaces.
    const owner = snap.sphere.members.find((m) => m.id === agent.ownerId);
    if (owner === undefined) return err(409, "invalid_request", "Agent has no resolvable owner");
    const agentSubject: PolicyRequest["subject"] = {
      agentId: agent.id,
      memberId: owner.id,
      role: owner.role,
      ageProfile: ageProfileForRole(owner.role as Role),
    };
    const projection = projectAgentRuntimeConfig({
      agentId: agent.id,
      subject: agentSubject,
      runtimeConfig: imported.runtimeConfig,
      catalog: defaultCapabilityCatalog(),
      policies: imported.policies,
      bindings: imported.bindings,
      context: { sphereId, time: stamp, execution: "local", correlationId },
      gatewayEndpoint: `mcp+http://spheres/${sphereId}/mcp`,
      authSecretRef: `secret://sphere-mcp/${sphereId}/${agent.id}`,
      version: 1,
    });
    return ok({
      agentId: projection.agentId,
      provider: projection.profile.providerId,
      model: projection.profile.model,
      execution: projection.profile.execution,
      gatewayEndpoint: projection.gateway.endpoint,
      authSecretRef: projection.gateway.authSecretRef,
      allowedTools: projection.gateway.allowedTools,
      nativeToolsAllow: projection.nativeToolsAllow,
      autonomousInstallDisabled: projection.autonomousInstallDisabled,
    });
  }

  if (req.method !== "GET") {
    return err(405, "invalid_request", "Only GET is supported by the read API");
  }

  if (segments.length === 1 && segments[0] === "health") {
    return ok({ ok: true });
  }

  if (segments.length === 1 && segments[0] === "capabilities") {
    // Read-only capability catalog metadata (RFC-003): the admin surface for
    // choosing an agent's capability scope. Capabilities are the only
    // agent-facing surface; no raw tool ids are exposed. This is a floor/default
    // — the Policy Engine still governs every call (coding principle 1).
    return ok({
      capabilities: [...defaultCapabilityCatalog().values()].map((c) => ({
        name: c.name,
        description: c.description,
        risk: c.risk,
        allowedProfiles: c.allowedProfiles,
        approvalFloor: c.approvalFloor,
      })),
    });
  }

  if (segments.length === 1 && segments[0] === "store") {
    // store.browse (RFC-002): the curated catalog of installable packages.
    return ok({
      packages: defaultStoreCatalog().map((m) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        description: m.description,
        version: m.version,
        publisher: m.publisher,
        ageRating: m.ageRating,
        dependencies: m.dependencies,
        providesCapabilities: m.providesCapabilities,
      })),
    });
  }

  if (segments[0] === "spheres") {
    if (segments.length === 1) {
      return ok({ spheres: await deps.store.list() });
    }
    if (segments.length === 2) {
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      return ok({
        id: snap.sphere.id,
        name: snap.sphere.name,
        type: snap.sphere.type,
        status: snap.sphere.status,
        members: snap.sphere.members.length,
        identities: snap.identities.length,
      });
    }
    if (segments.length === 3 && (segments[2] === "members" || segments[2] === "agents")) {
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      if (segments[2] === "members") {
        // Security facts only: id, role, status — never private profile content.
        return ok({
          members: snap.sphere.members.map((m) => ({ id: m.id, role: m.role, status: m.status })),
        });
      }
      return ok({
        agents: snap.agents.map((a) => ({
          id: a.id,
          name: a.name,
          ownerId: a.ownerId,
          state: a.state,
          enabledCapabilities: a.enabledCapabilities,
          ...(a.modelPreference !== undefined ? { modelPreference: a.modelPreference } : {}),
        })),
      });
    }
    if (segments.length === 3 && segments[2] === "sessions") {
      // RFC-005: a member's session summaries (no message content — private).
      if (deps.sessions === undefined) return err(501, "invalid_request", "Chat sessions are not enabled");
      if ((await deps.store.load(segments[1] as string)) === undefined) return err(404, "not_found", "Sphere not found");
      const ownerId = req.query?.["ownerId"];
      if (typeof ownerId !== "string" || ownerId === "") {
        return err(400, "invalid_request", "ownerId is required");
      }
      const list = await deps.sessions.listForOwner(segments[1] as string, ownerId);
      return ok({
        sessions: list.map((s) => ({
          id: s.id,
          title: s.title,
          agentId: s.agentId,
          state: s.state,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
        })),
      });
    }
    if (segments.length === 4 && segments[2] === "sessions") {
      // RFC-005: read one session with its transcript — owner-private, policy-scoped.
      if (deps.sessions === undefined) return err(501, "invalid_request", "Chat sessions are not enabled");
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      const session = await deps.sessions.load(segments[3] as string);
      if (session === undefined || session.sphereId !== segments[1]) return err(404, "not_found", "Session not found");
      const ownerId = req.query?.["ownerId"];
      if (typeof ownerId !== "string" || ownerId === "") return err(400, "invalid_request", "ownerId is required");
      // Derive the subject's role from Sphere membership (not client-claimed).
      const member = snap.sphere.members.find((m) => m.id === ownerId);
      if (member === undefined) return err(403, "forbidden", "Not a member of this Sphere");
      const subject = { memberId: ownerId, role: member.role, ageProfile: ageProfileForRole(member.role) };
      const decision = authorizeSessionRead(subject, session, importSphere(snap).policies, {
        sphereId: segments[1] as string,
        time: (deps.now ?? (() => new Date().toISOString()))(),
        correlationId,
      });
      if (decision.effect !== "allow") return err(403, "forbidden", decision.reason);
      return ok({
        id: session.id,
        title: session.title,
        agentId: session.agentId,
        state: session.state,
        updatedAt: session.updatedAt,
        messages: session.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
      });
    }
    if (segments.length === 3 && segments[2] === "packages") {
      // Installed packages (RFC-002): manifest facts + lifecycle status.
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      return ok({
        packages: importSphere(snap).packages.map((p) => ({
          id: p.manifest.id,
          type: p.manifest.type,
          title: p.manifest.title,
          description: p.manifest.description,
          status: p.status,
        })),
      });
    }
    if (segments.length === 3 && segments[2] === "integrations") {
      // Connectors (integration-model): facts only — never the secret value.
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      return ok({
        integrations: importSphere(snap).integrations.map((i) => ({
          id: i.id,
          provider: i.provider,
          status: i.status,
          scopes: i.scopes,
          providesCapabilities: i.providesCapabilities,
        })),
      });
    }
    if (segments.length === 3 && segments[2] === "policies") {
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      return ok({ policies: importSphere(snap).policies });
    }
    if (segments.length === 3 && segments[2] === "runtime") {
      // RFC-004: the resolved inference profile a Sphere would use (no secrets).
      const snap = await deps.store.load(segments[1] as string);
      if (snap === undefined) return err(404, "not_found", "Sphere not found");
      const { runtimeConfig } = importSphere(snap);
      const profile = resolveEffectiveProfile(runtimeConfig);
      let allowed = true;
      try {
        assertProfileAllowed(runtimeConfig, profile);
      } catch {
        allowed = false;
      }
      return ok({
        provider: profile.providerId,
        model: profile.model,
        execution: profile.execution,
        cloudInferenceEnabled: runtimeConfig.cloudInferenceEnabled,
        allowedProviders: runtimeConfig.allowedProviders,
        allowed,
        // Hermes is the sole Harness (ADR-008 §3) — there is nothing to select,
        // so this reports it rather than reading a harness switch. The
        // provider/model it runs on are the *governed* ones (RFC-004/009)
        // projected into its profile, never a Harness-local or env default
        // (ADR-008 §4); only the address of the Harness itself is deployment.
        harness: {
          runtime: "hermes",
          provider: profile.providerId,
          model: profile.model,
          baseUrl: process.env["HERMES_BASE_URL"] ?? "http://hermes:8642/v1",
        },
      });
    }
  }

  if (segments[0] === "approvals" && segments.length === 1) {
    const pending = await deps.approvals.listPending(req.query?.["sphereId"]);
    return ok({
      pending: pending.map((p) => ({
        id: p.approval.id,
        sphereId: p.approval.sphereId,
        capability: p.approval.action.capabilityName,
        state: p.approval.state,
        approverRoles: p.approval.approverRoles,
      })),
    });
  }

  if (segments[0] === "audit" && segments.length === 2) {
    return ok({ events: deps.audit.byCorrelation(segments[1] as string) });
  }

  return err(404, "not_found", "Unknown route");
}
