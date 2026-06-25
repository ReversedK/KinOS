import { apiBaseUrl, getSphere, getSpheres, type SphereSummary } from "../lib/api";

// Read-only view: lists Spheres and their summaries from the API. The UI shows
// Spheres/members, never embeddings, vector stores, MCP internals or runtime
// details (results-contract §18).
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

  if (error !== undefined) {
    return (
      <main>
        <p style={{ color: "#f28b82" }}>
          Could not reach the KinOS API at <code>{base}</code>: {error}
        </p>
        <p style={{ color: "#9aa0a6" }}>Start it with <code>npm run serve -w @kinos/api</code>.</p>
      </main>
    );
  }

  if (summaries.length === 0) {
    return (
      <main>
        <p style={{ color: "#9aa0a6" }}>No Spheres yet. Create one with the CLI:</p>
        <pre>kinos init sph_1 &quot;Doe Family&quot;</pre>
      </main>
    );
  }

  return (
    <main>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
        {summaries.map((s) => (
          <li
            key={s.id}
            style={{ border: "1px solid #2a2d34", borderRadius: 8, padding: "1rem" }}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{s.name}</div>
            <div style={{ color: "#9aa0a6", fontSize: "0.9rem" }}>
              {s.type} · {s.status} · {s.members} member{s.members === 1 ? "" : "s"}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
