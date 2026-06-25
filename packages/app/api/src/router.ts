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

import type { ApprovalStore, AuditReader, SphereStore } from "@kinos/core";

export interface ApiDeps {
  readonly store: SphereStore;
  readonly approvals: ApprovalStore;
  readonly audit: AuditReader;
  readonly newCorrelationId: () => string;
}

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
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

  if (req.method !== "GET") {
    return err(405, "invalid_request", "Only GET is supported by the read API");
  }

  const segments = req.path.split("/").filter((s) => s.length > 0);

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
