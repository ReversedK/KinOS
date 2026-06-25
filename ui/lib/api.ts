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

const DEFAULT_BASE_URL = "http://localhost:8787";

export function apiBaseUrl(): string {
  return process.env.KINOS_API_URL ?? DEFAULT_BASE_URL;
}

async function getJson<T>(baseUrl: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${baseUrl}${path}`);
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
