"use client";

import { useState } from "react";

import {
  CLIENT_API_BASE,
  beginOAuthConnect,
  configureIntegration,
  getIntegrationCalendars,
  setIntegrationEnabled,
  type ActingSubject,
  type GoogleCalendarChoice,
  type IntegrationSummary,
} from "../../../lib/api";

/**
 * Connectors (integrations) view (RFC-003 / integration-model / RFC-016/018/034/037).
 * Each connector is a small GUIDED WIZARD: pick provider → connect (OAuth) or set a
 * credential reference → (choose calendars) → enable. The UI only triggers governed
 * endpoints; the Policy Engine decides. Secrets are never shown — only the connector,
 * its status, and the capabilities it provides.
 */

/** Map an integration's capabilities to a category accent tile + glyph. */
function category(caps: readonly string[]): { tile: string; glyph: string } {
  const has = (p: string) => caps.some((c) => c.startsWith(p));
  if (has("calendar.")) return { tile: "calendar", glyph: "📅" };
  if (has("document.") || has("memory.")) return { tile: "docs", glyph: "📄" };
  if (has("message.")) return { tile: "message", glyph: "✉" };
  if (has("payment.")) return { tile: "payment", glyph: "❖" };
  if (has("native.")) return { tile: "harness", glyph: "⚙" };
  return { tile: "store", glyph: "⇄" };
}

function authKindOf(i: IntegrationSummary): "none" | "oauth" | "apikey" {
  if (i.auth === "oauth") return "oauth";
  if (i.auth === "apikey") return "apikey";
  return i.provider === "local" ? "none" : "oauth";
}

export function Connectors({
  sphereId,
  actor,
  integrations,
}: {
  sphereId: string;
  actor: ActingSubject;
  integrations: readonly IntegrationSummary[];
}) {
  const [rows, setRows] = useState<readonly IntegrationSummary[]>(integrations);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [secretRefs, setSecretRefs] = useState<Record<string, string>>({});
  const [calendars, setCalendars] = useState<Record<string, readonly GoogleCalendarChoice[]>>({});
  const [managing, setManaging] = useState<Record<string, boolean>>({});

  const patch = (id: string, next: Partial<IntegrationSummary>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)));

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setNote(undefined);
    try {
      await fn();
    } catch (e) {
      setNote(`Error — ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, enabled: boolean) =>
    run(async () => {
      const res = await setIntegrationEnabled(CLIENT_API_BASE, sphereId, id, enabled, actor);
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) patch(id, { status: res.status });
    });

  const connect = (id: string) =>
    run(async () => {
      const res = await beginOAuthConnect(CLIENT_API_BASE, sphereId, id, actor);
      if (res.authorizeUrl !== undefined) window.location.href = res.authorizeUrl;
      else setNote(`Denied — ${res.message ?? "cannot connect"}`);
    });

  const saveCredential = (id: string) =>
    run(async () => {
      const ref = (secretRefs[id] ?? "").trim();
      if (ref === "") return;
      const res = await configureIntegration(CLIENT_API_BASE, sphereId, id, { secretRef: ref }, actor);
      if (res.configured) patch(id, { configured: true });
      else setNote(res.message ?? "Could not configure");
    });

  const setProvider = (row: IntegrationSummary, provider: string) =>
    run(async () => {
      if (provider === row.provider) return;
      const auth = row.providerChoices?.find((c) => c.provider === provider)?.auth ?? "none";
      const res = await configureIntegration(CLIENT_API_BASE, sphereId, row.id, { provider }, actor);
      if (res.code === undefined && res.provider !== undefined) patch(row.id, { provider, auth: auth === "none" ? undefined : auth, configured: false });
      else setNote(res.message ?? "Could not set provider");
    });

  const loadCalendars = (id: string) =>
    run(async () => {
      const res = await getIntegrationCalendars(CLIENT_API_BASE, sphereId, id, actor);
      if (res.calendars !== undefined) setCalendars((c) => ({ ...c, [id]: res.calendars! }));
      else setNote(res.message ?? "Could not list calendars");
    });

  const toggleCalendar = (row: IntegrationSummary, calendarId: string) =>
    run(async () => {
      const current = row.config?.calendarIds ?? [];
      const next = current.includes(calendarId) ? current.filter((c) => c !== calendarId) : [...current, calendarId];
      const res = await configureIntegration(CLIENT_API_BASE, sphereId, row.id, { config: { calendarIds: next } }, actor);
      if (res.code === undefined) patch(row.id, { config: { ...row.config, calendarIds: next } });
      else setNote(res.message ?? "Could not save calendar selection");
    });

  if (rows.length === 0) {
    return (
      <div className="empty">
        <span className="empty-glyph">⇄</span>
        No connectors yet.
        <div className="faint" style={{ marginTop: 8 }}>Add one from the Store to give agents a real calendar, documents, or other service.</div>
      </div>
    );
  }

  return (
    <div className="stack">
      {rows.map((i) => {
        const cat = category(i.providesCapabilities);
        const kind = authKindOf(i);
        const connected = i.configured === true || kind === "none";
        const enabled = i.status === "enabled";
        const isCalendar = i.providesCapabilities.some((c) => c.startsWith("calendar."));
        // Wizard steps for this connector's auth kind.
        const steps = kind === "none" ? ["Enable"] : isCalendar ? ["Connect", "Calendars", "Enable"] : [kind === "apikey" ? "Credentials" : "Connect", "Enable"];
        const activeIdx = !connected ? 0 : !enabled ? steps.length - 1 : steps.length;
        const chooseCalendars = calendars[i.id];
        const selectedCals = i.config?.calendarIds ?? [];

        return (
          <div key={i.id} className="wizard reveal">
            <div className="wizard-head" style={{ background: "transparent", borderBottom: "1px solid var(--line)" }}>
              <div className="row between" style={{ flexWrap: "nowrap", gap: "var(--s3)" }}>
                <div className="row" style={{ gap: "var(--s3)", minWidth: 0, flexWrap: "nowrap" }}>
                  <span className={`tile ${cat.tile}`}>{cat.glyph}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, textTransform: "capitalize" }}>{i.provider.replace(/_/g, " ")}</div>
                    <div className="faint mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.providesCapabilities.join(" · ") || "—"}</div>
                  </div>
                </div>
                <span className={`badge ${enabled ? "allow" : connected ? "info" : ""}`} style={{ flex: "none" }}>
                  <span className="dot" />
                  {enabled ? "active" : connected ? "connected" : "setup"}
                </span>
              </div>
              {steps.length > 1 ? (
                <ol className="stepper" style={{ margin: "var(--s4) 0 0" }}>
                  {steps.map((label, idx) => (
                    <li key={label} className={idx < activeIdx ? "done" : idx === activeIdx ? "active" : ""}>
                      <span className="step-num">{idx < activeIdx ? "✓" : idx + 1}</span>
                      {label}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>

            <div className="wizard-body stack tight">
              {/* Provider choice (RFC-034) — offered while not yet connected. */}
              {!connected && i.providerChoices !== undefined && i.providerChoices.length > 1 ? (
                <div className="field" style={{ maxWidth: 320 }}>
                  <label>Provider</label>
                  <select className="select" value={i.provider} disabled={busy} onChange={(e) => void setProvider(i, e.target.value)}>
                    {i.providerChoices.map((c) => (
                      <option key={c.provider} value={c.provider}>
                        {c.provider.replace(/_/g, " ")}{c.auth === "none" ? " — built-in, no setup" : c.auth === "oauth" ? " — connect account" : " — API key"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {/* STEP: connect / credentials / built-in */}
              {!connected ? (
                kind === "oauth" ? (
                  <div className="stack tight">
                    <p className="section-intro">Connect the account. You'll consent on the provider; KinOS stores only a reference, never a token.</p>
                    <div><button className="btn primary" disabled={busy} onClick={() => void connect(i.id)}>Connect {i.provider.replace(/_/g, " ")} →</button></div>
                  </div>
                ) : kind === "apikey" ? (
                  <div className="row" style={{ gap: "var(--s2)", alignItems: "flex-end" }}>
                    <div className="field grow">
                      <label>Credentials reference</label>
                      <input className="input mono" placeholder="secret://provider/…" value={secretRefs[i.id] ?? ""} onChange={(e) => setSecretRefs((s) => ({ ...s, [i.id]: e.target.value }))} />
                      <span className="hint">A secret-store reference — never paste a raw key.</span>
                    </div>
                    <button className="btn primary" disabled={busy} onClick={() => void saveCredential(i.id)}>Save</button>
                  </div>
                ) : (
                  <p className="section-intro">Built-in provider — no account needed. Enable it below.</p>
                )
              ) : null}

              {/* STEP: choose calendars (RFC-037) — optional, once connected */}
              {connected && isCalendar ? (
                <div className="stack tight">
                  {chooseCalendars === undefined ? (
                    <div className="row between">
                      <span className="faint" style={{ fontSize: 13 }}>{selectedCals.length > 0 ? `${selectedCals.length} calendar${selectedCals.length === 1 ? "" : "s"} selected` : "Using your primary calendar"}</span>
                      <button className="btn sm ghost" disabled={busy} onClick={() => void loadCalendars(i.id)}>Choose calendars…</button>
                    </div>
                  ) : (
                    <div className="stack tight" style={{ gap: 4 }}>
                      <label className="faint" style={{ fontSize: 12 }}>Calendars this connector may use (none = primary)</label>
                      {chooseCalendars.map((c) => (
                        <label key={c.id} className="checkline" style={{ justifyContent: "space-between" }}>
                          <span className="row" style={{ gap: "var(--s2)" }}>
                            <input type="checkbox" checked={selectedCals.includes(c.id)} disabled={busy} onChange={() => void toggleCalendar(i, c.id)} />
                            <span style={{ color: "var(--ink)" }}>{c.summary}{c.primary ? " · primary" : ""}</span>
                          </span>
                          <span className="pill">{c.accessRole}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {/* STEP: enable — the final step */}
              {connected && !enabled ? (
                <div className="row between">
                  <span className="faint" style={{ fontSize: 13 }}>Enabling activates these tools for members your policies allow.</span>
                  <button className="btn primary" disabled={busy} onClick={() => void toggle(i.id, true)}>Enable connector</button>
                </div>
              ) : null}

              {/* READY — enabled: compact, with a manage disclosure */}
              {enabled ? (
                <div className="stack tight">
                  <div className="row between">
                    <span className="badge allow"><span className="dot" />Ready — agents can use this</span>
                    <button className="btn sm ghost" disabled={busy} onClick={() => setManaging((m) => ({ ...m, [i.id]: !m[i.id] }))}>{managing[i.id] ? "Close" : "Manage"}</button>
                  </div>
                  {managing[i.id] ? (
                    <div className="row" style={{ gap: "var(--s2)" }}>
                      {kind === "oauth" ? <button className="btn sm" disabled={busy} onClick={() => void connect(i.id)}>Reconnect</button> : null}
                      {isCalendar ? <button className="btn sm" disabled={busy} onClick={() => void loadCalendars(i.id)}>Calendars</button> : null}
                      <button className="btn sm danger" disabled={busy} onClick={() => void toggle(i.id, false)}>Disable</button>
                    </div>
                  ) : null}
                  {managing[i.id] && isCalendar && chooseCalendars !== undefined ? (
                    <div className="stack tight" style={{ gap: 4 }}>
                      {chooseCalendars.map((c) => (
                        <label key={c.id} className="checkline" style={{ justifyContent: "space-between" }}>
                          <span className="row" style={{ gap: "var(--s2)" }}>
                            <input type="checkbox" checked={selectedCals.includes(c.id)} disabled={busy} onChange={() => void toggleCalendar(i, c.id)} />
                            <span style={{ color: "var(--ink)" }}>{c.summary}{c.primary ? " · primary" : ""}</span>
                          </span>
                          <span className="pill">{c.accessRole}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {note ? <div className="note deny">{note}</div> : null}
    </div>
  );
}
