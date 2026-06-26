/**
 * KinOS API client (UI side).
 *
 * Framework-agnostic typed wrappers over the read API (api-contract.md). The UI
 * only reads already-governed state — it performs no authorization and shows no
 * runtime/embedding/MCP internals (results-contract §18, coding principle 1).
 */

export interface SphereSummary {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly members: number;
  readonly identities: number;
}

export interface PendingApproval {
  readonly id: string;
  readonly sphereId: string;
  readonly capability: string;
  readonly state: string;
  readonly approverRoles: readonly string[];
}

export interface MemberSummary {
  readonly id: string;
  readonly role: string;
  readonly status: string;
}

export interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly state: string;
  readonly enabledCapabilities: readonly string[];
}

export interface RuntimeInfo {
  readonly provider: string;
  readonly model: string;
  readonly execution: string;
  readonly cloudInferenceEnabled: boolean;
  readonly allowedProviders: readonly string[];
  readonly allowed: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:8787";

export function apiBaseUrl(): string {
  return process.env.KINOS_API_URL ?? DEFAULT_BASE_URL;
}

async function getJson<T>(baseUrl: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  // Live read: never serve a cached response (Next caches fetch by default).
  const res = await fetchImpl(`${baseUrl}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function getSpheres(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<readonly string[]> {
  const body = await getJson<{ spheres: readonly string[] }>(baseUrl, "/spheres", fetchImpl);
  return body.spheres;
}

export async function getSphere(
  baseUrl: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SphereSummary> {
  return getJson<SphereSummary>(baseUrl, `/spheres/${encodeURIComponent(id)}`, fetchImpl);
}

export async function getPendingApprovals(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly PendingApproval[]> {
  const body = await getJson<{ pending: readonly PendingApproval[] }>(baseUrl, "/approvals", fetchImpl);
  return body.pending;
}

export async function getMembers(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly MemberSummary[]> {
  const body = await getJson<{ members: readonly MemberSummary[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/members`,
    fetchImpl,
  );
  return body.members;
}

export async function getAgents(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly AgentSummary[]> {
  const body = await getJson<{ agents: readonly AgentSummary[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/agents`,
    fetchImpl,
  );
  return body.agents;
}

export async function getRuntime(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeInfo> {
  return getJson<RuntimeInfo>(baseUrl, `/spheres/${encodeURIComponent(sphereId)}/runtime`, fetchImpl);
}

// --- Governed write actions (RFC-003) ---
//
// The UI only triggers governed actions; the Policy Engine decides. These
// wrappers post to the governed write endpoints and surface the outcome
// (executed / denied / pending approval) — they never decide authorization.

/** The acting subject. Real identity resolution/auth is server-side (RFC-003/006). */
export interface ActingSubject {
  readonly memberId?: string;
  readonly role: string;
  readonly ageProfile: string;
}

export interface ExecutionOutcome {
  /** "executed" | "pending_approval" — or undefined on a denial. */
  readonly status?: string;
  readonly reason?: string;
  readonly approvalId?: string;
  readonly approverRoles?: readonly string[];
  /** Set on a denial (HTTP 403): "forbidden". */
  readonly code?: string;
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: T }> {
  const res = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return { status: res.status, body: (await res.json()) as T };
}

/**
 * Request a governed capability execution. A denial (403) is a governed outcome,
 * not a transport error, so it is returned rather than thrown; unexpected
 * statuses (e.g. 501 disabled, 5xx) throw.
 */
export async function executeCapability(
  baseUrl: string,
  sphereId: string,
  capability: string,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  const { status, body } = await postJson<ExecutionOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/capabilities/${encodeURIComponent(capability)}/execute`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 202 || status === 403) return body;
  throw new Error(`execute ${capability} failed: ${status}`);
}

export interface SetRuntimeInput {
  readonly providerId: string;
  readonly model: string;
  readonly execution: string;
  readonly baseUrl?: string;
  readonly secretRef?: string;
}

export interface SetRuntimeOutcome {
  /** "executed" on success; undefined on a denial. */
  readonly status?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly execution?: string;
  /** Set on a denial (HTTP 403): "forbidden". */
  readonly code?: string;
  readonly message?: string;
}

/**
 * Change a Sphere's inference provider/model via the governed write endpoint. A
 * denial (403) is a governed outcome and is returned, not thrown; bad input (400)
 * and unexpected statuses (404/501/5xx) throw.
 */
export async function setRuntime(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  profile: SetRuntimeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SetRuntimeOutcome> {
  const { status, body } = await postJson<SetRuntimeOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/runtime`,
    { subject, profile },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`set runtime failed: ${status}`);
}

export interface ApproverRef {
  readonly memberId: string;
  readonly role: string;
}

export interface ApprovalOutcome {
  readonly approvalId: string;
  readonly capability: string;
  readonly status: string;
  readonly reason?: string;
}

async function resolveApprovalAction(
  baseUrl: string,
  approvalId: string,
  decision: "grant" | "deny",
  approver: ApproverRef,
  fetchImpl: typeof fetch,
): Promise<ApprovalOutcome> {
  const { status, body } = await postJson<ApprovalOutcome>(
    baseUrl,
    `/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    { approver },
    fetchImpl,
  );
  if (status !== 200) {
    throw new Error(`${decision} ${approvalId} failed: ${status}`);
  }
  return body;
}

export function grantApproval(
  baseUrl: string,
  approvalId: string,
  approver: ApproverRef,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalOutcome> {
  return resolveApprovalAction(baseUrl, approvalId, "grant", approver, fetchImpl);
}

export function denyApproval(
  baseUrl: string,
  approvalId: string,
  approver: ApproverRef,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalOutcome> {
  return resolveApprovalAction(baseUrl, approvalId, "deny", approver, fetchImpl);
}
