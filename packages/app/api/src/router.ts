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
  defaultCapabilityCatalog,
  importSphere,
  resolveApproval,
  resolveEffectiveProfile,
  type ApprovalStore,
  type AuditReader,
  type AuditSink,
  type CapabilityExecutionRequest,
  type CapabilityExecutor,
  type Role,
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
