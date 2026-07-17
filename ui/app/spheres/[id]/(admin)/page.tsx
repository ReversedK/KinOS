import { Activity } from "../../../../components/Activity";
import {
  apiBaseUrl,
  getAgents,
  getIntegrations,
  getMembers,
  getPendingApprovals,
  getPolicies,
  getRuntime,
  getSphereAudit,
} from "../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Sphere overview — the at-a-glance landing. Health stats, what needs a human
 * decision now, and the most recent governed activity, each linking into its
 * focused section. The one broad-fetch page (a dashboard summarizes everything);
 * every other section loads only its own slice.
 */
export default async function SphereOverview({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;

  const [members, agents, runtime, integrations, policies, pendingApprovals, activity] = await Promise.all([
    getMembers(base, id).catch(() => []),
    getAgents(base, id).catch(() => []),
    getRuntime(base, id).catch(() => undefined),
    getIntegrations(base, id).catch(() => []),
    getPolicies(base, id).catch(() => []),
    getPendingApprovals(base, id).catch(() => []),
    getSphereAudit(base, id, 8).catch(() => []),
  ]);

  const href = (slug: string) => `/spheres/${encodeURIComponent(id)}/${slug}`;
  const stats: { label: string; value: string; sub?: string; to: string }[] = [
    { label: "members", value: String(members.length), to: "members" },
    { label: "agents", value: String(agents.length), to: "agents" },
    { label: "runtime", value: runtime?.provider ?? "—", sub: runtime?.model, to: "settings" },
    { label: "connectors", value: String(integrations.filter((i) => i.status === "enabled").length), to: "settings" },
    { label: "active rules", value: String(policies.filter((p) => p.status === "active").length), to: "access" },
    { label: "pending approvals", value: String(pendingApprovals.length), to: "access" },
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {stats.map((s) => (
          <a key={s.label} href={href(s.to)} className="card" style={{ padding: "var(--s4)" }}>
            <div className="eyebrow">{s.label}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
              {s.value}
            </div>
            {s.sub ? <div className="faint" style={{ fontSize: 12 }}>{s.sub}</div> : null}
          </a>
        ))}
      </div>

      {/* Needs attention — the one thing an operator most wants on landing. */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Human-in-the-loop</span>
            <h3>Needs attention</h3>
          </div>
          {pendingApprovals.length > 0 ? (
            <a className="btn sm ghost" href={href("access")}>Review →</a>
          ) : null}
        </div>
        <div className="panel-body">
          {pendingApprovals.length === 0 ? (
            <div className="empty"><span className="empty-glyph">✓</span>Nothing awaiting a decision. Approval-gated actions appear here for review.</div>
          ) : (
            <div className="stack tight">
              {pendingApprovals.slice(0, 5).map((p) => (
                <a key={p.id} href={href("access")} className="rowitem">
                  <span className="lead">
                    <span className="badge pending"><span className="dot" />{p.state}</span>
                    <span>
                      <code>{p.capability}</code>
                      {p.summary ? <div className="faint" style={{ fontSize: 12 }}>{p.summary}</div> : null}
                    </span>
                  </span>
                  {p.risk ? <span className={`badge ${p.risk === "critical" || p.risk === "high" ? "deny" : ""}`}>{p.risk}</span> : null}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent activity — a preview; the full audit lives in Activity. */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Audit</span>
            <h3>Recent activity</h3>
          </div>
          <a className="btn sm ghost" href={href("activity")}>Full log →</a>
        </div>
        <div className="panel-body">
          <Activity events={activity} />
        </div>
      </div>
    </>
  );
}
