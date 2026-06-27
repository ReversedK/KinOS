/**
 * Sphere MCP server transport (RFC-007, ADR-007).
 *
 * Wraps the tested core governed dispatch (`handleSphereMcpCall`) in a minimal
 * MCP JSON-RPC surface — `tools/list` and `tools/call` — authenticated by the
 * per-agent bearer token (ADR-007). The transport decides reachability; the
 * token decides identity; the Policy Engine decides authorization. Per ADR-007
 * this is served only on a private interface (Unix socket co-located, else the
 * private compose network) and never published.
 *
 * It is transport-agnostic: a parsed JSON-RPC request + bearer token in, a
 * JSON-RPC response out. The HTTP wiring (server.ts) maps Authorization and the
 * `/spheres/:id/mcp` path onto it.
 */

import {
  ageProfileForRole,
  defaultCapabilityCatalog,
  handleSphereMcpCall,
  importSphere,
  resolveAuthorizedCapabilities,
  type AgentTokenStore,
  type ApprovalStore,
  type AuditSink,
  type CapabilityExecutor,
  type PolicyRequest,
  type Role,
  type SphereStore,
} from "@kinos/core";

export interface SphereMcpServerDeps {
  readonly store: SphereStore;
  readonly tokens: AgentTokenStore;
  readonly executor: CapabilityExecutor;
  readonly auditSink: AuditSink;
  readonly approvals: ApprovalStore;
  readonly newApprovalId: () => string;
  readonly newCorrelationId: () => string;
  readonly now?: () => string;
}

export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

// JSON-RPC error codes: -32601 method not found, -32602 invalid params,
// -32600 invalid request; -32000 server/auth (deny by default at the gateway).
const AUTH_ERROR = -32000;

export async function handleSphereMcpRpc(
  input: { readonly sphereId: string; readonly token: string; readonly request: JsonRpcRequest },
  deps: SphereMcpServerDeps,
): Promise<JsonRpcResponse> {
  const id = input.request.id ?? null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
  const now = (deps.now ?? (() => new Date().toISOString()))();

  // Authenticate the bearer token first (fail closed). The token both identifies
  // the agent and binds the call to its Sphere — a token for another Sphere is
  // refused even on the right path.
  const tok = deps.tokens.resolve(input.token);
  if (tok === undefined || tok.sphereId !== input.sphereId) {
    return fail(AUTH_ERROR, "Unauthenticated credential at the Sphere MCP gateway.");
  }

  const snap = await deps.store.load(input.sphereId);
  if (snap === undefined) return fail(AUTH_ERROR, "Sphere not found.");
  const agent = snap.agents.find((a) => a.id === tok.agentId);
  if (agent === undefined) return fail(AUTH_ERROR, "Calling agent is not in this Sphere.");
  const owner = snap.sphere.members.find((m) => m.id === agent.ownerId);
  if (owner === undefined) return fail(AUTH_ERROR, "Calling agent has no resolvable owner.");

  // Subject derived from the credential -> agent -> owner. Never client-claimed.
  const subject: PolicyRequest["subject"] = {
    agentId: agent.id,
    memberId: owner.id,
    role: owner.role,
    ageProfile: ageProfileForRole(owner.role as Role),
  };
  const imported = importSphere(snap);
  const catalog = defaultCapabilityCatalog();

  if (input.request.method === "tools/list") {
    const ctx = { sphereId: input.sphereId, time: now, execution: "local" as const, correlationId: deps.newCorrelationId() };
    const surface = resolveAuthorizedCapabilities(subject, ctx, {
      catalog,
      policies: imported.policies,
      bindings: imported.bindings,
    });
    return ok({
      tools: surface.map((c) => ({
        name: c.name,
        description: catalog.get(c.name)?.description ?? c.name,
        annotations: { requiresApproval: c.requiresApproval },
      })),
    });
  }

  if (input.request.method === "tools/call") {
    const params = (typeof input.request.params === "object" && input.request.params !== null
      ? input.request.params
      : {}) as { name?: string; arguments?: unknown };
    if (typeof params.name !== "string") return fail(-32602, "tools/call requires a tool name.");

    const result = await handleSphereMcpCall(
      { token: input.token, capabilityName: params.name, input: params.arguments },
      {
        sphereId: input.sphereId,
        resolveAgentByToken: (t) => (t === input.token ? { agentId: agent.id, subject } : undefined),
        catalog,
        bindings: imported.bindings,
        policies: imported.policies,
        executor: deps.executor,
        audit: deps.auditSink,
        newApprovalId: deps.newApprovalId,
        newCorrelationId: deps.newCorrelationId,
        now: () => now,
      },
    );

    if (result.status === "pending_approval" && result.approval !== undefined) {
      // Persist the raised request so an approver can resolve it via the API.
      await deps.approvals.save({
        approval: result.approval,
        request: {
          subject,
          capabilityName: params.name,
          input: params.arguments ?? {},
          context: { sphereId: input.sphereId, time: now, execution: "local", correlationId: result.correlationId },
        },
      });
    }

    if (result.status === "ok") {
      return ok({ content: [{ type: "text", text: JSON.stringify(result.output ?? null) }], isError: false });
    }
    // denied / pending_approval / unauthenticated -> a tool error result (the
    // call did not execute). The reason is user-safe; no content leaks.
    return ok({
      content: [{ type: "text", text: result.reason }],
      isError: true,
      _meta: { status: result.status, correlationId: result.correlationId },
    });
  }

  return fail(-32601, `Unknown method: ${String(input.request.method)}`);
}
