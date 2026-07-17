"use client";

import { useMemo, useState } from "react";

import type { SphereSummary } from "../lib/api";

const TYPE_GLYPH: Record<string, string> = { family: "⌂", person: "○", team: "◇", organization: "▤" };

/**
 * The Spheres front door. Server-rendered summaries are passed in; filtering is
 * client-side so the list stays usable as it grows (search by name or id, filter
 * by type). Presentational — it navigates, it decides nothing.
 */
export function SphereList({ spheres }: { spheres: readonly SphereSummary[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");

  // Only offer type chips that actually occur, plus "all".
  const types = useMemo(() => ["all", ...Array.from(new Set(spheres.map((s) => s.type))).sort()], [spheres]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return spheres.filter((s) => {
      if (type !== "all" && s.type !== type) return false;
      if (needle === "") return true;
      return s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle);
    });
  }, [spheres, q, type]);

  const filtering = q.trim() !== "" || type !== "all";

  return (
    <div className="stack">
      <div className="row between" style={{ gap: "var(--s3)", flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          type="search"
          placeholder="Search Spheres by name or id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search Spheres"
          style={{ maxWidth: 320 }}
        />
        {types.length > 2 ? (
          <div className="row" style={{ gap: "var(--s1)", flexWrap: "wrap" }}>
            {types.map((t) => (
              <button
                key={t}
                className={`chip${type === t ? " active" : ""}`}
                onClick={() => setType(t)}
                aria-pressed={type === t}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
        <span className="faint mono" style={{ fontSize: 12, marginLeft: "auto" }}>
          {filtering ? `${shown.length} of ${spheres.length}` : `${spheres.length} sphere${spheres.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <span className="empty-glyph">⌕</span>
          No Spheres match <span className="mono">{q.trim() !== "" ? `"${q.trim()}"` : type}</span>.
        </div>
      ) : (
        <div className="grid cols-2">
          {shown.map((s) => (
            <a key={s.id} href={`/spheres/${encodeURIComponent(s.id)}`} className="card reveal">
              <div className="row between">
                <div className="row" style={{ gap: "var(--s3)" }}>
                  <span className="glyph" style={{ background: "var(--panel-2)", color: "var(--brand)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                    {TYPE_GLYPH[s.type] ?? "◈"}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
                    <div className="faint mono" style={{ fontSize: 12 }}>{s.id}</div>
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
  );
}
