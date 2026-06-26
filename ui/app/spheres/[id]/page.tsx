import { apiBaseUrl, getAgents, getMembers, getRuntime, getSphere } from "../../../lib/api";
import { RunCapability } from "./RunCapability";

// Read-only Sphere detail: members and agents (security facts only — role,
// status, capabilities), never private profile or memory content (§18).
export default async function SpherePage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  try {
    const [sphere, members, agents, runtime] = await Promise.all([
      getSphere(base, params.id),
      getMembers(base, params.id),
      getAgents(base, params.id),
      getRuntime(base, params.id),
    ]);

    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href="/" style={{ color: "#8ab4f8" }}>← Spheres</a>
        </p>
        <h2 style={{ marginBottom: 0 }}>{sphere.name}</h2>
        <div style={{ color: "#9aa0a6", fontSize: "0.9rem" }}>
          {sphere.type} · {sphere.status}
        </div>

        <section style={{ marginTop: "1.5rem" }}>
          <h3>Members ({members.length})</h3>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
            {members.map((m) => (
              <li key={m.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
                <strong>{m.role}</strong> · {m.status} <span style={{ color: "#9aa0a6" }}>({m.id})</span>
              </li>
            ))}
          </ul>
        </section>

        <section style={{ marginTop: "1.5rem" }}>
          <h3>Agents ({agents.length})</h3>
          {agents.length === 0 ? (
            <p style={{ color: "#9aa0a6" }}>No agents yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
              {agents.map((a) => (
                <li key={a.id} style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
                  <strong>{a.name}</strong> · {a.state}{" "}
                  <span style={{ color: "#9aa0a6" }}>· {a.enabledCapabilities.length} capabilities</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: "1.5rem" }}>
          <h3>Inference runtime</h3>
          <div style={{ border: "1px solid #2a2d34", borderRadius: 6, padding: "0.5rem 0.75rem" }}>
            <strong>{runtime.provider}</strong> · {runtime.model}{" "}
            <span style={{ color: "#9aa0a6" }}>
              · {runtime.execution}
              {runtime.execution === "cloud" ? (runtime.cloudInferenceEnabled ? " (cloud on)" : " (cloud disabled)") : ""}
            </span>
            <div style={{ color: "#9aa0a6", fontSize: "0.85rem" }}>
              allowed providers: {runtime.allowedProviders.join(", ")}
              {runtime.allowed ? "" : " · current profile not permitted"}
            </div>
          </div>
        </section>

        <section style={{ marginTop: "1.5rem" }}>
          <h3>Run a capability</h3>
          <p style={{ color: "#9aa0a6", fontSize: "0.85rem", marginTop: 0 }}>
            Requests a governed execution; the Policy Engine decides (allow / deny / approval).
          </p>
          <RunCapability
            baseUrl={base}
            sphereId={params.id}
            members={members.map((m) => ({ id: m.id, role: m.role }))}
          />
        </section>
      </main>
    );
  } catch (e) {
    return (
      <main>
        <p style={{ marginTop: 0 }}>
          <a href="/" style={{ color: "#8ab4f8" }}>← Spheres</a>
        </p>
        <p style={{ color: "#f28b82" }}>Could not load Sphere {params.id}: {(e as Error).message}</p>
      </main>
    );
  }
}
