import { apiBaseUrl, getInstalledPackages, getMembers, getSphere, getStoreCatalog } from "../../../../lib/api";
import { Store } from "./Store";

export const dynamic = "force-dynamic";

// Package store (RFC-002): browse the curated catalog and manage installed
// packages. The client component talks to the governed store endpoints; install
// never grants use (policies do), and the Policy Engine gates every call.
export default async function StorePage({ params }: { params: { id: string } }) {
  const base = apiBaseUrl();
  const id = params.id;
  try {
    const [sphere, members, catalog, installed] = await Promise.all([
      getSphere(base, id),
      getMembers(base, id),
      getStoreCatalog(base),
      getInstalledPackages(base, id),
    ]);
    return (
      <div className="container">
        <div className="crumbs">
          <a href="/">spheres</a> / <a href={`/spheres/${encodeURIComponent(id)}`}>{sphere.name}</a> / store
        </div>
        <div className="stack loose">
          <div className="stack tight">
            <span className="eyebrow">packages &amp; skills</span>
            <h1 className="title">Store</h1>
            <p className="help">
              Install skills, connectors and agent templates into this Sphere. Installing registers capabilities and bindings
              (disabled by default) — it never grants use; policies and the grant flow do.
            </p>
          </div>
          <Store
            sphereId={id}
            members={members.map((m) => ({ id: m.id, role: m.role }))}
            catalog={catalog}
            installed={installed}
          />
        </div>
      </div>
    );
  } catch (e) {
    return (
      <div className="container narrow">
        <div className="crumbs">
          <a href="/">spheres</a> / store
        </div>
        <div className="note deny">Could not load the store for {id} — {(e as Error).message}</div>
      </div>
    );
  }
}
