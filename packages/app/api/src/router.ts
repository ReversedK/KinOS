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
  createRuntimeProfile,
  createSession,
  defaultCapabilityCatalog,
  disableIntegration,
  enableIntegration,
  evaluate,
  exportSphere,
  importSphere,
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
    const request: CapabilityExecutionRequest = {
      subject,
      capabilityName,
      input: body.input === undefined ? {} : body.input,
      context: {
        sphereId,
        time: (deps.now ?? (() => new Date().toISOString()))(),
        execution: body.execution === "cloud" ? "cloud" : "local",
        correlationId,
      },
    };

    const result = await beginSensitiveAction(request, {
      catalog: defaultCapabilityCatalog(),
      bindings: imported.bindings,
      policies: imported.policies,
      executor: deps.executor,
      audit: deps.auditSink,
      newApprovalId: deps.newApprovalId,
    });

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
    return ok({ status: result.status, reason: result.reason });
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

    const result = await resolveApproval(
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
        bindings: imported.bindings,
        policies: imported.policies,
        executor: deps.executor,
        audit: deps.auditSink,
        newApprovalId: () => approvalId,
      },
    );

    if (result.approval !== undefined) {
      await deps.approvals.save({ approval: result.approval, request: pending.request });
    }
    return ok({
      approvalId,
      capability: pending.approval.action.capabilityName,
      status: result.status,
      reason: result.reason,
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
      imported.policies,
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
      imported.policies,
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
    const model = resolveEffectiveProfile(imported.runtimeConfig).model;
    const stamp = (deps.now ?? (() => new Date().toISOString()))();

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
    } catch {
      // Owner-private: a non-owner subject is refused (deny by default).
      return err(403, "forbidden", "Not authorized for this session");
    }

    await deps.sessions.save(result.session);
    return ok({ sessionId, reply: result.reply, messageCount: result.session.messages.length });
  }

  if (req.method !== "GET") {
    return err(405, "invalid_request", "Only GET is supported by the read API");
  }

  if (segments.length === 1 && segments[0] === "health") {
    return ok({ ok: true });
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
