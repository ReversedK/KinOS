import { InviteMember } from "../../../../../components/InviteMember";
import { apiBaseUrl, getMembers, resolveActingAdmin } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function MembersSection({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { actor?: string };
}) {
  const base = apiBaseUrl();
  const id = params.id;
  const members = await getMembers(base, id).catch(() => []);
  const { admin } = resolveActingAdmin(members, searchParams.actor);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Members · {members.length}</h3>
        <InviteMember sphereId={id} admin={admin} />
      </div>
      <div className="panel-body flush">
        {members.length === 0 ? (
          <div className="empty" style={{ margin: "var(--s5)" }}>No members yet. Invite the first — you become a Sphere of people the agents represent.</div>
        ) : (
          <div className="tablewrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>role</th>
                  <th>member id</th>
                  <th>status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="badge">{m.role}</span>
                      {["child", "teenager"].includes(m.role) ? <span className="badge info" style={{ marginLeft: 6 }}>minor</span> : null}
                    </td>
                    <td>
                      <code>{m.id}</code>
                    </td>
                    <td className="faint">{m.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
