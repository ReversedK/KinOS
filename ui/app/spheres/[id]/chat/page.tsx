import { apiBaseUrl, getAgents, getMembers, getSphere } from "../../../../lib/api";
import { Tui } from "./Tui";

export const dynamic = "force-dynamic";

/**
 * Test agents in real conditions (ADR-008 §6). Loads agents (facts only) and
 * mounts the Harness terminal, which attaches to an agent's own governed Hermes
 * profile.
 *
 * This is deliberately not the old direct-inference chat bench: ADR-008 §6
 * classified that path as test-mode because it never exercised the Harness loop,
 * and authorized migrating real-condition testing onto the Harness. Here the
 * agent genuinely runs inside it.
 */
export default async function TestAgentsPage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  try {
    const [sphere, members, agents] = await Promise.all([
      getSphere(base, id),
      getMembers(base, id),
      getAgents(base, id),
    ]);
    // Act as an administrator: attaching is admin-gated, and the Policy Engine
    // re-checks it server-side regardless of what the console sends.
    const admin = members.find((m) => m.role === "parent") ?? members[0];
    return (
      <div className="container">
        <div className="crumbs">
          <a href="/">spheres</a> / <a href={`/spheres/${encodeURIComponent(id)}`}>{sphere.name}</a> / test
        </div>
        <div className="stack">
          <div className="stack tight">
            <span className="eyebrow">real-condition testing</span>
            <h1 className="title">Test agents</h1>
            <p className="help">
              Attach a terminal to a deployed agent&apos;s governed Hermes profile. The agent runs inside the Harness — on the model
              KinOS decided, reaching back into the Sphere MCP for exactly its policy-authorized capabilities, with every call
              re-checked there.
            </p>
          </div>
          {agents.length === 0 ? (
            <div className="empty">
              No agents to test yet. Deploy one from the{" "}
              <a href={`/spheres/${encodeURIComponent(id)}`} className="mono" style={{ color: "var(--brand)" }}>
                Sphere console
              </a>
              .
            </div>
          ) : admin === undefined ? (
            <div className="note deny">This Sphere has no member to act as.</div>
          ) : (
            <Tui
              sphereId={id}
              agents={agents.map((a) => ({ id: a.id, name: a.name }))}
              actor={{ memberId: admin.id, role: admin.role, ageProfile: "adult" }}
            />
          )}
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div className="container narrow">
        <div className="crumbs">
          <a href="/">spheres</a> / test
        </div>
        <div className="note deny">Could not load the test console for {id} — {(e as Error).message}</div>
      </div>
    );
  }
}
