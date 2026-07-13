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
    <div className="container narrow">
      <div className="crumbs">
        <a href="/">spheres</a> / approvals
      </div>
      <div className="stack loose">
        <div className="stack tight">
          <span className="eyebrow">human-in-the-loop</span>
          <h1 className="title">Approvals inbox</h1>
          <p className="help">
            Sensitive actions the Policy Engine routed for a human decision. Granting or denying is governed — quorum, minor-safety
            and no-self-approval are enforced by the core, not this screen.
          </p>
        </div>

        {error !== undefined ? (
          <div className="note deny">Could not load approvals — {error}</div>
        ) : pending.length === 0 ? (
          <div className="empty">
            Nothing awaiting approval.
            <div className="faint" style={{ marginTop: 8 }}>
              Approval-gated actions (e.g. <span className="mono">payment.execute</span>) will appear here.
            </div>
          </div>
        ) : (
          <div className="stack">
            {pending.map((p) => (
              <div key={p.id} className="panel reveal">
                <div className="panel-body stack tight">
                  <div className="row between">
                    <code style={{ fontSize: 15, fontWeight: 600 }}>{p.capability}</code>
                    <span className="badge pending">
                      <span className="dot" />
                      {p.state}
                    </span>
                  </div>
                  <div className="row" style={{ gap: "var(--s4)" }}>
                    <span className="faint">
                      sphere <code>{p.sphereId}</code>
                    </span>
                    <span className="faint">
                      approvers {p.approverRoles.map((r) => (
                        <span key={r} className="pill" style={{ marginLeft: 4 }}>
                          {r}
                        </span>
                      ))}
                    </span>
                    <span className="faint">
                      <code>{p.id}</code>
                    </span>
                  </div>
                  <ApprovalActions approvalId={p.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
