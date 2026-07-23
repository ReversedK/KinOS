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
  isNativeToolsetCapability,
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

  // MCP lifecycle (Streamable HTTP): the client opens with `initialize`, then
  // sends the `notifications/initialized` notification, before any tools/* call.
  // These are token-authenticated (the bearer is on every request) but need no
  // Sphere resolution. `ping` is a liveness no-op.
  if (input.request.method === "initialize") {
    const params = (typeof input.request.params === "object" && input.request.params !== null
      ? input.request.params
      : {}) as { protocolVersion?: string };
    return ok({
      // Echo the client's protocol version when given (version negotiation).
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "kinos-sphere-mcp", version: "0.1.0" },
    });
  }
  if (input.request.method === "notifications/initialized" || input.request.method === "ping") {
    return ok({});
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
      // RFC-027: offer only capabilities within this agent's declared scope.
      agentScope: agent.enabledCapabilities,
    });
    return ok({
      // `native.<toolset>` grants are a distinct channel (RFC-025): the runtime
      // uses those of its own native tools directly, so they are never offered as
      // Sphere-MCP tools. Only MCP-backed capabilities appear here.
      tools: surface.filter((c) => !isNativeToolsetCapability(c.name)).map((c) => ({
        name: c.name,
        description: catalog.get(c.name)?.description ?? c.name,
        // The capability's declared input JSON Schema (catalog) so the agent knows
        // the exact arguments — a required id, a query — instead of guessing. Falls
        // back to a permissive object for capabilities that take free-form input.
        inputSchema: catalog.get(c.name)?.inputSchema ?? { type: "object", additionalProperties: true },
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
        // RFC-027: carry the agent's declared scope so out-of-scope calls are refused.
        resolveAgentByToken: (t) => (t === input.token ? { agentId: agent.id, subject, scope: agent.enabledCapabilities } : undefined),
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
    if (result.status === "pending_approval") {
      // A deferred, LEGITIMATE outcome — not an error. Tell the agent clearly so it
      // relays "approval requested" to the user instead of reporting a failure and
      // giving up (RFC-040). isError:false because the request was accepted & queued;
      // the message makes unambiguous that it has NOT run yet.
      const approvalId = result.approval?.id ?? "(pending)";
      const roles = result.approval?.approverRoles?.join(", ") ?? "an approver";
      const text =
        `Approval required — this action was NOT performed yet. A request has been submitted for a human to approve ` +
        `(approval ${approvalId}; approver: ${roles}). It will run automatically once approved in the Approvals inbox. ` +
        `Tell the user their approval is needed there; do not retry this tool.`;
      return ok({
        content: [{ type: "text", text }],
        isError: false,
        _meta: { status: "pending_approval", approvalId, correlationId: result.correlationId },
      });
    }
    // denied / unauthenticated / failed -> a real tool error. The reason is
    // user-safe; no content leaks.
    return ok({
      content: [{ type: "text", text: result.reason }],
      isError: true,
      _meta: { status: result.status, correlationId: result.correlationId },
    });
  }

  return fail(-32601, `Unknown method: ${String(input.request.method)}`);
}
