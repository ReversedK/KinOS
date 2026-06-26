import { apiBaseUrl, getPendingApprovals } from "../../lib/api";
import { ApprovalActions } from "./ApprovalActions";

export const dynamic = "force-dynamic";

// Read-only pending approvals: a supervisor sees what awaits a human decision —
// capability, Sphere, eligible approver roles — never the action's private
// payload (§18, privacy-model audit minimality).
export default async function ApprovalsPage() {
  const base = apiBaseUrl();
  let pending: Awaited<ReturnType<typeof getPendingApprovals>> = [];
  let error: string | undefined;
  try {
    pending = await getPendingApprovals(base);
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main>
      <p style={{ marginTop: 0 }}>
        <a href="/" style={{ color: "#8ab4f8" }}>← Spheres</a>
      </p>
      <h2>Pending approvals</h2>
      {error !== undefined ? (
        <p style={{ color: "#f28b82" }}>Could not load approvals: {error}</p>
      ) : pending.length === 0 ? (
        <p style={{ color: "#9aa0a6" }}>Nothing awaiting approval.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
          {pending.map((p) => (
            <li key={p.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
              <strong>{p.capability}</strong> in {p.sphereId}
              <div style={{ color: "#9aa0a6", fontSize: "0.9rem" }}>
                approvers: {p.approverRoles.join(", ")} · {p.id}
              </div>
              <ApprovalActions baseUrl={base} approvalId={p.id} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
