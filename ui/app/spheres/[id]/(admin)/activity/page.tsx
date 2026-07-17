import { Activity } from "../../../../../components/Activity";
import { apiBaseUrl, getSphereAudit } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Activity — the governance chain made visible (RFC-020). Every governed action,
 * grouped by correlation id: who asked, which policy version decided, whether
 * approval was required, and what executed. Records carry no conversation,
 * memory content, or credentials (§18 audit minimality).
 */
export default async function ActivitySection({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const activity = await getSphereAudit(base, params.id, 40).catch(() => []);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Audit</span>
          <h3>Activity</h3>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>security facts · never content</span>
      </div>
      <div className="panel-body">
        <Activity events={activity} />
      </div>
    </div>
  );
}
