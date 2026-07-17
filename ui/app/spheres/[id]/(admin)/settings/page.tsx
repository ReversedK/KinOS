import { ArchiveSphere } from "../../../../../components/ArchiveSphere";
import { ExportSphere } from "../../../../../components/ExportSphere";
import { Connectors } from "../../Connectors";
import { SetRuntime } from "../../SetRuntime";
import { apiBaseUrl, getIntegrations, getMembers, getRuntime, getSphere, resolveActingAdmin } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Settings — how the Sphere is configured: its governed inference profile and
 * harness (RFC-004/ADR-008), its connectors (integration-model), and portability
 * (RFC-021 export). Every control triggers the governed pipeline; the Policy
 * Engine decides.
 */
export default async function SettingsSection({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { actor?: string };
}) {
  const base = apiBaseUrl();
  const id = params.id;
  const [members, runtime, integrations, sphere] = await Promise.all([
    getMembers(base, id).catch(() => []),
    getRuntime(base, id),
    getIntegrations(base, id).catch(() => []),
    getSphere(base, id).catch(() => undefined),
  ]);
  const { admin } = resolveActingAdmin(members, searchParams.actor);

  return (
    <>
      {/* Runtime & harness (RFC-004 / ADR-008). */}
      <div className="panel">
        <div className="panel-head">
          <h3>Runtime & harness</h3>
          <span className="badge">
            <span className="dot" />
            {runtime.execution}
            {runtime.execution === "cloud" ? (runtime.cloudInferenceEnabled ? " · cloud on" : " · cloud disabled") : ""}
          </span>
        </div>
        <div className="panel-body stack">
          <div className="runtime-explainer">
            <span className="runtime-number">01</span>
            <div className="stack tight">
              <span className="eyebrow">Sphere inference profile</span>
              <p className="section-intro">The governed default used for KinOS conversations. It chooses where inference runs and which model is requested; changing it never changes identities, memory, or permissions.</p>
              <div className="row" style={{ gap: "var(--s4)" }}>
                <span>provider <code>{runtime.provider}</code></span>
                <span>model <code>{runtime.model}</code></span>
                <span className="faint">
                  allowed: {runtime.allowedProviders.join(", ")}
                  {runtime.allowed ? "" : " · current profile not permitted"}
                </span>
              </div>
            </div>
          </div>
          <div className="runtime-explainer">
            <span className="runtime-number">02</span>
            <div className="stack tight">
              <span className="eyebrow">Active agent harness</span>
              <p className="section-intro">
                The governed environment every agent runs inside — it hosts agent profiles and tool calling, and never executes bare. Hermes is
                the only harness, so there is nothing to choose here; KinOS remains the authority for permissions and exposed capabilities, and
                the inference backend below is the governed choice projected into its profile.
              </p>
              <div className="row" style={{ gap: "var(--s4)" }}>
                <span>harness <code>{runtime.harness.runtime}</code></span>
                {runtime.harness.provider ? <span>backend <code>{runtime.harness.provider}</code></span> : null}
                {runtime.harness.model ? <span>model <code>{runtime.harness.model}</code></span> : null}
                {runtime.harness.baseUrl ? <span className="faint">endpoint <code>{runtime.harness.baseUrl}</code></span> : null}
              </div>
            </div>
          </div>
          <hr className="hairline" style={{ margin: 0 }} />
          <SetRuntime sphereId={id} actor={admin} />
        </div>
      </div>

      {/* Connectors (integration-model / RFC-016/018). */}
      <div className="panel">
        <div className="panel-head">
          <h3>Connectors</h3>
        </div>
        <div className="panel-body">
          <Connectors sphereId={id} actor={admin} integrations={integrations} />
        </div>
      </div>

      {/* Portability (RFC-021): governed, approval-floored, adult-only export. */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Portability</span>
            <h3>Export</h3>
          </div>
        </div>
        <div className="panel-body stack tight">
          <p className="section-intro">
            Export the whole Sphere for backup or migration. Always approval-floored: another adult must release the file, and it is delivered
            to whoever grants — no single administrator takes it alone.
          </p>
          <ExportSphere sphereId={id} admin={admin} />
        </div>
      </div>

      {/* Lifecycle (RFC-024): archive/restore — reversible, governed. */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Lifecycle</span>
            <h3>Archive</h3>
          </div>
        </div>
        <div className="panel-body">
          <ArchiveSphere sphereId={id} admin={admin} status={sphere?.status ?? "active"} />
        </div>
      </div>
    </>
  );
}
