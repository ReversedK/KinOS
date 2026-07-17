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
  /** Threads this approval to its audit chain (RFC-020). */
  readonly correlationId?: string;
  /** User-safe description of the requested action (never private content). */
  readonly summary?: string;
  readonly risk?: string;
  readonly requestedByAgent?: string;
  readonly onBehalfOf?: string;
  readonly state: string;
  readonly approverRoles: readonly string[];
  readonly createdAt?: string;
  readonly expiresAt?: string;
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
  readonly modelPreference?: string;
}

export interface RuntimeInfo {
  readonly provider: string;
  readonly model: string;
  readonly execution: string;
  readonly cloudInferenceEnabled: boolean;
  readonly allowedProviders: readonly string[];
  readonly allowed: boolean;
  readonly harness: {
    readonly runtime: string;
    readonly model?: string;
    readonly provider?: string;
    readonly baseUrl?: string;
  };
}

export type PolicyEffect = "allow" | "deny" | "require_approval";
export type PolicyStatus = "draft" | "test" | "active" | "disabled" | "superseded" | "archived";

export interface SpherePolicy {
  readonly id: string;
  readonly sphereId: string;
  readonly description: string;
  readonly subjectSelector: {
    readonly roles?: readonly string[];
    readonly ageProfiles?: readonly ("adult" | "teen" | "child")[];
    readonly memberIds?: readonly string[];
  };
  readonly action: "execute" | "any";
  readonly resourceSelector: {
    readonly capabilityNames?: readonly string[];
    readonly riskLevels?: readonly string[];
  };
  readonly effect: PolicyEffect;
  readonly approverRoles?: readonly string[];
  readonly priority: number;
  readonly version: number;
  readonly status: PolicyStatus;
}

const DEFAULT_BASE_URL = "http://localhost:8787";

/**
 * Server-side base URL for the KinOS API. Used by React Server Components, which
 * call the API directly (server-to-server, no CORS).
 */
export function apiBaseUrl(): string {
  return process.env.KINOS_API_URL ?? DEFAULT_BASE_URL;
}

/**
 * Client-side base URL. Browser code hits the Next same-origin proxy
 * (`/api/kinos/*`), which forwards to the KinOS API server-side — no CORS, and
 * the API URL never leaves the server. Client components pass this to the
 * wrappers below in place of a real API origin.
 */
export const CLIENT_API_BASE = "/api/kinos";

/** Map a Sphere role to its age profile (mirrors the core's ageProfileForRole). */
export function ageProfileForRole(role: string): "adult" | "teen" | "child" {
  if (role === "child") return "child";
  if (role === "teenager") return "teen";
  return "adult";
}

/**
 * The administrator acting in the console (dev: the selected identity, else the
 * first parent, else the first member). Anticipates real auth / RFC-006
 * impersonation — being "admin in the UI" grants nothing; the Policy Engine still
 * decides. Shared by the workspace sections so each derives the same acting
 * subject from `?actor=`.
 */
export function resolveActingAdmin(
  members: readonly MemberSummary[],
  actorId?: string,
): { adminMember?: MemberSummary; admin: ActingSubject } {
  const adminMember =
    members.find((m) => m.id === actorId) ?? members.find((m) => m.role === "parent") ?? members[0];
  const admin: ActingSubject = adminMember
    ? { memberId: adminMember.id, role: adminMember.role, ageProfile: ageProfileForRole(adminMember.role) }
    : { role: "parent", ageProfile: "adult" };
  return { adminMember, admin };
}

export interface CatalogCapability {
  readonly name: string;
  readonly description: string;
  readonly risk: string;
  readonly allowedProfiles: readonly string[];
  readonly approvalFloor: boolean;
}

export async function getCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly CatalogCapability[]> {
  const body = await getJson<{ capabilities: readonly CatalogCapability[] }>(baseUrl, "/capabilities", fetchImpl);
  return body.capabilities;
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
  sphereId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly PendingApproval[]> {
  const path = sphereId === undefined ? "/approvals" : `/approvals?sphereId=${encodeURIComponent(sphereId)}`;
  const body = await getJson<{ pending: readonly PendingApproval[] }>(baseUrl, path, fetchImpl);
  return body.pending;
}

// --- Audit APIs (RFC-020, api-contract §Audit APIs) ---

/**
 * A recorded security fact. Audit minimality is guaranteed at record time
 * (event-model): these carry ids, decision class, deciding policy and a
 * correlation id — never conversation text, memory content, or credentials.
 */
export interface AuditEvent {
  readonly id: string;
  readonly type: string;
  readonly sphereId: string;
  readonly actorId?: string;
  readonly agentId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly decision?: string;
  readonly reason?: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

/** Recent activity for a Sphere, newest first. The server caps `limit`. */
export async function getSphereAudit(
  baseUrl: string,
  sphereId: string,
  limit?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly AuditEvent[]> {
  const q = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
  const body = await getJson<{ events: readonly AuditEvent[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/audit${q}`,
    fetchImpl,
  );
  return body.events;
}

/** The event chain for one sensitive action (policy → approval → execution). */
export async function getAuditChain(
  baseUrl: string,
  correlationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly AuditEvent[]> {
  const body = await getJson<{ events: readonly AuditEvent[] }>(
    baseUrl,
    `/audit/${encodeURIComponent(correlationId)}`,
    fetchImpl,
  );
  return body.events;
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

export async function getPolicies(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly SpherePolicy[]> {
  const body = await getJson<{ policies: readonly SpherePolicy[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/policies`,
    fetchImpl,
  );
  return body.policies;
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
  /** Executor side-effect result on success (e.g. a new sphere/member/agent id). */
  readonly output?: unknown;
  /** Set on a denial (403: "forbidden") or execution failure (422). */
  readonly code?: string;
  readonly message?: string;
}

export interface RuntimeProjectOutput {
  readonly agentId: string;
  readonly version: number;
  readonly allowedTools: readonly string[];
  readonly configPath: string;
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
  input?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  const { status, body } = await postJson<ExecutionOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/capabilities/${encodeURIComponent(capability)}/execute`,
    input === undefined ? { subject } : { subject, input },
    fetchImpl,
  );
  // Governed outcomes (allow/approval/deny) and an authorized-but-failed side
  // effect (422) are all returned; only transport/unknown statuses throw.
  if (status === 200 || status === 202 || status === 403 || status === 422) return body;
  throw new Error(`execute ${capability} failed: ${status}`);
}

// --- Governed provisioning (RFC-008) ---

/**
 * Create a Sphere (bootstrap). Instance-scoped: the founder becomes the first
 * administrator and a default admin policy set is seeded. A denial (403) or an
 * execution failure (422) is a governed outcome and is returned.
 */
export async function createSphereRequest(
  baseUrl: string,
  subject: ActingSubject,
  input: { readonly name: string; readonly type?: string; readonly founderName?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  const { status, body } = await postJson<ExecutionOutcome>(baseUrl, "/spheres", { subject, input }, fetchImpl);
  if (status === 200 || status === 202 || status === 403 || status === 422) return body;
  throw new Error(`create sphere failed: ${status}`);
}

export function inviteMember(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  input: { readonly role: string; readonly displayName: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "member.invite", subject, input, fetchImpl);
}

export function deployAgent(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  input: { readonly ownerId: string; readonly name: string; readonly capabilities?: readonly string[]; readonly model?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "agent.create", subject, input, fetchImpl);
}

export function updateAgentConfig(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  input: { readonly agentId: string; readonly capabilities?: readonly string[]; readonly model?: string; readonly state?: "active" | "paused" | "disabled" },
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "agent.update_config", subject, input, fetchImpl);
}

export function managePolicy(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  policy: SpherePolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "policy.manage", subject, { policy }, fetchImpl);
}

export function projectAgentRuntimeConfig(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  input: { readonly agentId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "runtime.config.project", subject, input, fetchImpl);
}

// --- Runtime config projection preview (RFC-007/ADR-007) ---

export interface RuntimeProjection {
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
  readonly execution: string;
  readonly gatewayEndpoint: string;
  readonly authSecretRef: string;
  readonly allowedTools: readonly string[];
  readonly nativeToolsAllow: readonly string[];
  readonly autonomousInstallDisabled: boolean;
  /** Set on a denial (HTTP 403). */
  readonly code?: string;
  readonly reason?: string;
}

/**
 * Preview the governed runtime config that would be projected to an agent's
 * runtime profile (the single Sphere MCP, the authorized tool surface, native
 * tools, install disabled). Admin-gated; a 403 is a governed outcome (returned).
 */
export async function getAgentRuntimeProjection(
  baseUrl: string,
  sphereId: string,
  agentId: string,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeProjection> {
  const { status, body } = await postJson<RuntimeProjection>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/agents/${encodeURIComponent(agentId)}/runtime/projection`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`projection for ${agentId} failed: ${status}`);
}

// --- Package store (RFC-002) ---

export interface StorePackage {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly version: string;
  readonly publisher: string;
  readonly ageRating: string;
  readonly dependencies: ReadonlyArray<{ readonly packageId: string; readonly versionRange: string }>;
  readonly providesCapabilities: readonly string[];
}

export interface InstalledPackageSummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
}

export interface PackageActionOutcome {
  readonly id?: string;
  readonly status?: string;
  readonly code?: string;
  readonly message?: string;
}

export async function getStoreCatalog(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<readonly StorePackage[]> {
  const body = await getJson<{ packages: readonly StorePackage[] }>(baseUrl, "/store", fetchImpl);
  return body.packages;
}

export async function getInstalledPackages(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly InstalledPackageSummary[]> {
  const body = await getJson<{ packages: readonly InstalledPackageSummary[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/packages`,
    fetchImpl,
  );
  return body.packages;
}

export async function installStorePackage(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  packageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PackageActionOutcome> {
  const { status, body } = await postJson<PackageActionOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/packages/install`,
    { subject, packageId },
    fetchImpl,
  );
  if (status === 200 || status === 403 || status === 409) return body;
  throw new Error(`install failed: ${status}`);
}

export async function setPackageEnabled(
  baseUrl: string,
  sphereId: string,
  packageId: string,
  enabled: boolean,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<PackageActionOutcome> {
  const action = enabled ? "enable" : "disable";
  const { status, body } = await postJson<PackageActionOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/packages/${encodeURIComponent(packageId)}/${action}`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`${action} package failed: ${status}`);
}

// --- Connectors / integrations (integration-model) ---

export interface IntegrationSummary {
  readonly id: string;
  readonly provider: string;
  readonly status: string;
  readonly scopes: readonly string[];
  readonly providesCapabilities: readonly string[];
  /** How it authorizes (RFC-018): oauth → Connect; apikey → Configure. */
  readonly auth?: "oauth" | "apikey";
  /** Whether credentials are set (never the reference value). */
  readonly configured?: boolean;
}

export async function getIntegrations(
  baseUrl: string,
  sphereId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly IntegrationSummary[]> {
  const body = await getJson<{ integrations: readonly IntegrationSummary[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/integrations`,
    fetchImpl,
  );
  return body.integrations;
}

export interface IntegrationToggleOutcome {
  readonly id?: string;
  readonly status?: string;
  /** Set on a denial (HTTP 403): "forbidden". */
  readonly code?: string;
  readonly message?: string;
}

/**
 * Enable or disable a connector via the governed endpoint. A denial (403) is a
 * governed outcome and is returned, not thrown; unexpected statuses throw.
 */
export async function setIntegrationEnabled(
  baseUrl: string,
  sphereId: string,
  integrationId: string,
  enabled: boolean,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<IntegrationToggleOutcome> {
  const action = enabled ? "enable" : "disable";
  const { status, body } = await postJson<IntegrationToggleOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/integrations/${encodeURIComponent(integrationId)}/${action}`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`${action} integration failed: ${status}`);
}

export interface OAuthBeginOutcome {
  readonly authorizeUrl?: string;
  readonly provider?: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Begin connecting an OAuth integration (RFC-018): returns the provider authorize
 * URL to redirect the browser to. A denial (403) is a governed outcome, returned.
 */
export async function beginOAuthConnect(
  baseUrl: string,
  sphereId: string,
  integrationId: string,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthBeginOutcome> {
  const { status, body } = await postJson<OAuthBeginOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/integrations/${encodeURIComponent(integrationId)}/oauth/begin`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`begin oauth failed: ${status}`);
}

export interface ConfigureIntegrationOutcome {
  readonly id?: string;
  readonly provider?: string;
  readonly configured?: boolean;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Configure an api-key integration (RFC-016): set the provider and a credentials
 * secret *reference* (never a value). A denial (403) is returned, not thrown.
 */
export async function configureIntegration(
  baseUrl: string,
  sphereId: string,
  integrationId: string,
  input: { provider?: string; secretRef?: string; scopes?: readonly string[] },
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<ConfigureIntegrationOutcome> {
  const { status, body } = await postJson<ConfigureIntegrationOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/integrations/${encodeURIComponent(integrationId)}/configure`,
    { subject, ...input },
    fetchImpl,
  );
  if (status === 200 || status === 403 || status === 400) return body;
  throw new Error(`configure integration failed: ${status}`);
}

// --- Chat sessions (RFC-005) ---

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface SessionDetail {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatMessage[];
}

export async function listSessions(
  baseUrl: string,
  sphereId: string,
  ownerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly SessionSummary[]> {
  const body = await getJson<{ sessions: readonly SessionSummary[] }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/sessions?ownerId=${encodeURIComponent(ownerId)}`,
    fetchImpl,
  );
  return body.sessions;
}

export async function getSession(
  baseUrl: string,
  sphereId: string,
  sessionId: string,
  ownerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionDetail> {
  return getJson<SessionDetail>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/sessions/${encodeURIComponent(sessionId)}?ownerId=${encodeURIComponent(ownerId)}`,
    fetchImpl,
  );
}

export async function createSession(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  agentId: string,
  title: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly id: string; readonly title: string; readonly agentId: string; readonly ownerId: string; readonly state: string }> {
  const { status, body } = await postJson<{ id: string; title: string; agentId: string; ownerId: string; state: string }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/sessions`,
    { subject, agentId, ...(title !== undefined ? { title } : {}) },
    fetchImpl,
  );
  if (status !== 200) throw new Error(`create session failed: ${status}`);
  return body;
}

export async function postChatTurn(
  baseUrl: string,
  sphereId: string,
  sessionId: string,
  subject: ActingSubject,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly sessionId: string; readonly reply: string; readonly messageCount: number }> {
  const { status, body } = await postJson<{ sessionId: string; reply: string; messageCount: number }>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
    { subject, text },
    fetchImpl,
  );
  if (status !== 200) throw new Error(`chat turn failed: ${status}`);
  return body;
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

export interface HarnessTerminalGrant {
  /** Single-use attach ticket; undefined on a denial. Never persisted or logged. */
  readonly ticket?: string;
  readonly expiresAt?: string;
  readonly agentId?: string;
  /** Set on a denial (HTTP 403): "forbidden". */
  readonly code?: string;
  readonly message?: string;
}

/**
 * Ask the API to authorize attaching a terminal to an agent's governed Harness
 * profile (ADR-008 §6). The Policy Engine decides; a denial (403) is a governed
 * outcome and is returned, not thrown. The returned ticket is single-use and
 * short-lived — it is handed straight to the bridge and never stored.
 */
export async function openHarnessTerminal(
  baseUrl: string,
  sphereId: string,
  agentId: string,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<HarnessTerminalGrant> {
  const { status, body } = await postJson<HarnessTerminalGrant>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/agents/${encodeURIComponent(agentId)}/runtime/tui`,
    { subject },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  if (status === 501) return { code: "not_implemented", message: "The Harness terminal is not enabled on this deployment." };
  throw new Error(`open harness terminal failed: ${status}`);
}

export interface SetAgentModelOutcome {
  /** "executed" on success; undefined on a denial. */
  readonly status?: string;
  readonly agentId?: string;
  readonly model?: string;
  /** Set on a denial (HTTP 403): "forbidden". */
  readonly code?: string;
  readonly message?: string;
}

/**
 * Set an agent's default model via the governed per-agent endpoint (RFC-009,
 * `model.set`). Admin/owner-only and deny-by-default — a denial (403) is a
 * governed outcome and is returned, not thrown; bad input (400) and unexpected
 * statuses (404/501/5xx) throw.
 */
export async function setAgentModel(
  baseUrl: string,
  sphereId: string,
  agentId: string,
  subject: ActingSubject,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SetAgentModelOutcome> {
  const { status, body } = await postJson<SetAgentModelOutcome>(
    baseUrl,
    `/spheres/${encodeURIComponent(sphereId)}/agents/${encodeURIComponent(agentId)}/model`,
    { subject, model },
    fetchImpl,
  );
  if (status === 200 || status === 403) return body;
  throw new Error(`set agent model failed: ${status}`);
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
  /**
   * The executed action's result, present once a grant authorizes it. For
   * `sphere.export` this is the snapshot itself (RFC-021) — an approval-gated
   * payload is delivered to the approver who releases it, not to the requester.
   */
  readonly output?: unknown;
}

export interface RestoreOutcome {
  readonly status?: string;
  readonly output?: { readonly sphereId?: string; readonly name?: string; readonly members?: number };
  readonly code?: string;
  readonly message?: string;
}

/**
 * Restore a Sphere from an export snapshot (RFC-022). Never overwrites: an id that
 * already exists is refused (409). A denial (403), a conflict (409) and a rejected
 * snapshot (422/400) are governed outcomes and are returned, not thrown.
 */
export async function restoreSphere(
  baseUrl: string,
  subject: ActingSubject,
  snapshot: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreOutcome> {
  const { status, body } = await postJson<RestoreOutcome>(baseUrl, "/spheres/restore", { subject, snapshot }, fetchImpl);
  if ([200, 400, 403, 409, 422].includes(status)) return body;
  throw new Error(`restore failed: ${status}`);
}

/** Governed export of the whole Sphere (RFC-021). Always approval-floored. */
export function requestSphereExport(
  baseUrl: string,
  sphereId: string,
  subject: ActingSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecutionOutcome> {
  return executeCapability(baseUrl, sphereId, "sphere.export", subject, undefined, fetchImpl);
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
