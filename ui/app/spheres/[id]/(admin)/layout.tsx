import { DevActorSwitcher } from "../../../../components/DevActorSwitcher";
import { SphereTabs } from "../../../../components/SphereTabs";
import { apiBaseUrl, getMembers, getSphere } from "../../../../lib/api";

export const dynamic = "force-dynamic";

/**
 * Sphere workspace shell (RFC-003). Wraps only the admin sections (chat and store
 * are standalone, outside this route group), giving every section one chrome:
 * a name breadcrumb, the header with quick actions, the section tab rail and the
 * dev identity switcher. Each section route below loads only its own data, so an
 * operator navigates focused views instead of scrolling one long document.
 */
export default async function SphereWorkspaceLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const base = apiBaseUrl();
  const id = params.id;

  let sphere: Awaited<ReturnType<typeof getSphere>> | undefined;
  let members: Awaited<ReturnType<typeof getMembers>> = [];
  let error: string | undefined;
  try {
    [sphere, members] = await Promise.all([getSphere(base, id), getMembers(base, id)]);
  } catch (e) {
    error = (e as Error).message;
  }

  if (error !== undefined || sphere === undefined) {
    return (
      <div className="container narrow">
        <div className="crumbs">
          <a href="/">spheres</a> / <span className="mono">{id}</span>
        </div>
        <div className="note deny">Could not load Sphere {id} — {error ?? "not found"}.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="crumbs">
        <a href="/">spheres</a> / {sphere.name} <span className="mono faint">· {sphere.id}</span>
      </div>

      <div className="admin-shell">
        <aside className="admin-rail">
          <SphereTabs sphereId={id} />
          <DevActorSwitcher members={members} />
          <div className="rail-note">
            <span className="eyebrow">Security model</span>
            <p>The selected identity never bypasses policy. It only determines whose existing rights apply.</p>
          </div>
        </aside>

        <main className="stack loose admin-content">
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div className="stack tight">
              <h1 className="title">{sphere.name}</h1>
              <div className="row" style={{ gap: "var(--s2)" }}>
                <span className="pill">{sphere.type}</span>
                <span className={`badge ${sphere.status === "active" ? "allow" : ""}`}>
                  <span className="dot" />
                  {sphere.status}
                </span>
              </div>
            </div>
            <div className="row">
              <a className="btn" href={`/spheres/${encodeURIComponent(id)}/store`}>
                Store
              </a>
              <a className="btn primary" href={`/spheres/${encodeURIComponent(id)}/chat`}>
                Test agents →
              </a>
            </div>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
