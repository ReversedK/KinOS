import { CreateSphere } from "../components/CreateSphere";
import { RestoreSphere } from "../components/RestoreSphere";
import { apiBaseUrl, getSphere, getSpheres, type SphereSummary } from "../lib/api";

// Renders against the live read API on every request (never prerendered stale).
export const dynamic = "force-dynamic";

const TYPE_GLYPH: Record<string, string> = { family: "⌂", person: "○", team: "◇", organization: "▤" };

export default async function Home() {
  const base = apiBaseUrl();
  let summaries: SphereSummary[] = [];
  let error: string | undefined;
  try {
    const ids = await getSpheres(base);
    summaries = await Promise.all(ids.map((id) => getSphere(base, id)));
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="container">
      <div className="stack loose">
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div className="stack tight">
            <span className="eyebrow">local-first trust infrastructure</span>
            <h1 className="title">Spheres</h1>
            <p className="help">
              A Sphere is a governed unit of human representation — a person, family, team or organization. Administer members,
              deploy permissioned agents, and test them under the same policy pipeline that governs production.
            </p>
          </div>
          <div className="row" style={{ gap: "var(--s2)" }}>
            {/* Portability (RFC-022): recreate a Sphere from an export snapshot.
                Bootstrap-trusted like creating one, and it never overwrites. */}
            <RestoreSphere operator={{ role: "parent", ageProfile: "adult" }} />
            <CreateSphere />
          </div>
        </div>

        {error !== undefined ? (
          <div className="note deny">
            Could not reach the KinOS API at <code>{base}</code> — {error}.
            <div className="faint" style={{ marginTop: 6 }}>
              Start it with <code>docker compose up api</code>.
            </div>
          </div>
        ) : summaries.length === 0 ? (
          <div className="empty">
            No Spheres yet.
            <div className="faint" style={{ marginTop: 8 }}>
              Create your first with <span className="mono">＋ New Sphere</span> above — you become its first administrator. Rebuilding after a
              loss? <span className="mono">Restore from file</span> recreates a Sphere from an export, governance and all.
            </div>
          </div>
        ) : (
          <div className="grid cols-2">
            {summaries.map((s) => (
              <a key={s.id} href={`/spheres/${encodeURIComponent(s.id)}`} className="card reveal">
                <div className="row between">
                  <div className="row" style={{ gap: "var(--s3)" }}>
                    <span className="glyph" style={{ background: "var(--panel-2)", color: "var(--brand)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                      {TYPE_GLYPH[s.type] ?? "◈"}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                      <div className="faint mono" style={{ fontSize: 12 }}>
                        {s.id}
                      </div>
                    </div>
                  </div>
                  <span className={`badge ${s.status === "active" ? "allow" : ""}`}>
                    <span className="dot" />
                    {s.status}
                  </span>
                </div>
                <hr className="hairline" />
                <div className="row" style={{ gap: "var(--s5)" }}>
                  <span className="faint">
                    <strong style={{ color: "var(--ink)" }}>{s.members}</strong> member{s.members === 1 ? "" : "s"}
                  </span>
                  <span className="pill">{s.type}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
