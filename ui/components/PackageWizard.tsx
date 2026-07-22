"use client";

import { useEffect, useState } from "react";

import {
  CLIENT_API_BASE,
  beginOAuthConnect,
  configureIntegration,
  getIntegrations,
  installStorePackage,
  setPackageEnabled,
  type ActingSubject,
  type GrantClause,
  type IntegrationSummary,
  type StorePackage,
} from "../lib/api";

/**
 * Package install WIZARD (RFC-002/014/016). Installing a package is a journey, not a
 * click: register it → decide WHO may use it (the grant) → enable it → and, for an
 * integration package, connect the external account. This walks the admin through
 * each governed step and calls out the manual/external ones (OAuth consent, operator
 * config, credential references). The UI only triggers governed endpoints.
 */

type Audience = "adults" | "teens" | "everyone";

const AUDIENCE_PROFILES: Record<Audience, readonly string[]> = {
  adults: ["adult"],
  teens: ["adult", "teen"],
  everyone: ["adult", "teen", "child"],
};

/** Whether this package needs a secret reference rather than OAuth (CalDAV etc.). */
function isApiKeyIntegration(i: IntegrationSummary | undefined): boolean {
  return i?.auth === "apikey";
}

export function PackageWizard({
  sphereId,
  subject,
  pkg,
  installedStatus,
  onClose,
  onStatus,
}: {
  sphereId: string;
  subject: ActingSubject;
  pkg: StorePackage;
  installedStatus: string | undefined;
  onClose: () => void;
  onStatus: (status: string) => void;
}) {
  const [status, setStatus] = useState<string | undefined>(installedStatus); // undefined | installed | enabled
  const [integration, setIntegration] = useState<IntegrationSummary | null | undefined>(undefined); // undefined=unknown, null=none
  const [audience, setAudience] = useState<Audience>("adults");
  const [secretRef, setSecretRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  const installed = status !== undefined;
  const enabled = status === "enabled";

  // Discover whether this package created a connector (integration) that needs setup.
  useEffect(() => {
    let alive = true;
    if (!installed) return;
    void (async () => {
      try {
        const all = await getIntegrations(CLIENT_API_BASE, sphereId);
        const found = all.find((i) => i.id === `int_${pkg.id}`) ?? null;
        if (alive) setIntegration(found);
      } catch {
        if (alive) setIntegration(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [installed, sphereId, pkg.id]);

  const needsConnector = integration !== null && integration !== undefined;
  const connected = integration?.configured === true;

  // Steps: Install → Grant → Enable → [Connect]. Connect only when a connector exists.
  const steps = ["Install", "Access", "Enable", ...(needsConnector ? ["Connect"] : [])];
  const activeIdx = !installed ? 0 : !enabled ? 1 : needsConnector && !connected ? 3 : steps.length;

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

  const doInstall = () =>
    run(async () => {
      const res = await installStorePackage(CLIENT_API_BASE, sphereId, subject, pkg.id);
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) {
        setStatus(res.status);
        onStatus(res.status);
      }
    });

  const doEnable = () =>
    run(async () => {
      // RFC-014: widen beyond the adults-only default only when the admin chose to.
      const grant: readonly GrantClause[] | undefined =
        audience === "adults"
          ? undefined
          : [{ ageProfiles: AUDIENCE_PROFILES[audience], capabilities: pkg.providesCapabilities, effect: "allow" as const }];
      const res = await setPackageEnabled(CLIENT_API_BASE, sphereId, pkg.id, true, subject, undefined, grant);
      if (res.code === "forbidden") setNote(`Denied — ${res.message ?? "forbidden"}`);
      else if (res.status !== undefined) {
        setStatus(res.status);
        onStatus(res.status);
      }
    });

  const doConnect = () =>
    run(async () => {
      if (integration == null) return;
      if (isApiKeyIntegration(integration)) {
        if (secretRef.trim() === "") return;
        const res = await configureIntegration(CLIENT_API_BASE, sphereId, integration.id, { secretRef: secretRef.trim() }, subject);
        if (res.configured) setIntegration({ ...integration, configured: true });
        else setNote(res.message ?? "Could not configure");
      } else {
        const res = await beginOAuthConnect(CLIENT_API_BASE, sphereId, integration.id, subject);
        if (res.authorizeUrl !== undefined) window.location.href = res.authorizeUrl;
        else setNote(`Denied — ${res.message ?? "cannot connect"}`);
      }
    });

  return (
    <div className="wizard" style={{ marginTop: "var(--s3)" }}>
      <div className="wizard-head">
        <div className="row between">
          <strong style={{ fontSize: 15 }}>Set up · {pkg.title}</strong>
          <button className="btn sm ghost" onClick={onClose}>Close</button>
        </div>
        <ol className="stepper" style={{ margin: "var(--s4) 0 0" }}>
          {steps.map((label, idx) => (
            <li key={label} className={idx < activeIdx ? "done" : idx === activeIdx ? "active" : ""}>
              <span className="step-num">{idx < activeIdx ? "✓" : idx + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </div>

      <div className="wizard-body stack">
        {/* STEP 1 — Install */}
        {!installed ? (
          <div className="stack tight">
            <p className="section-intro">Register this package's capabilities and tools in the Sphere. Installing grants nothing on its own — you choose who next.</p>
            <div><button className="btn primary" disabled={busy} onClick={() => void doInstall()}>Install {pkg.title}</button></div>
          </div>
        ) : null}

        {/* STEP 2 — Access (the grant): who may use it */}
        {installed && !enabled ? (
          <div className="stack tight">
            <div className="field">
              <label>Who may use this?</label>
              <span className="hint">The safe default is adults only. Widening is your explicit choice; the capability's own floor still applies (a child can never be granted a write it isn't allowed).</span>
            </div>
            <div className="stack tight" style={{ gap: 6 }}>
              {(["adults", "teens", "everyone"] as Audience[]).map((a) => (
                <label key={a} className="checkline" style={{ gap: 10 }}>
                  <input type="radio" name="audience" checked={audience === a} onChange={() => setAudience(a)} />
                  <span style={{ color: "var(--ink)" }}>
                    {a === "adults" ? "Adults only" : a === "teens" ? "Adults & teens" : "Everyone (adults, teens, children)"}
                    {a === "adults" ? <span className="pill brand" style={{ marginLeft: 8 }}>recommended</span> : null}
                  </span>
                </label>
              ))}
            </div>
            <div className="row"><button className="btn primary" disabled={busy} onClick={() => void doEnable()}>Grant &amp; enable →</button></div>
          </div>
        ) : null}

        {/* STEP 3/4 — Connect the account (integration packages only) */}
        {enabled && needsConnector ? (
          connected ? (
            <div className="note allow">Connected — this connector is ready. Fine-tune it (calendars, reconnect) in <a href={`/spheres/${encodeURIComponent(sphereId)}/settings`} style={{ textDecoration: "underline" }}>Settings → Connectors</a>.</div>
          ) : (
            <div className="stack tight">
              <p className="section-intro">
                This package uses an external service — connect the account to finish.{" "}
                {integration?.provider?.startsWith("google") ? "You'll consent on Google; KinOS stores only a reference, never a token." : null}
              </p>
              {isApiKeyIntegration(integration) ? (
                <div className="row" style={{ gap: "var(--s2)", alignItems: "flex-end" }}>
                  <div className="field grow">
                    <label>Credentials reference</label>
                    <input className="input mono" placeholder="secret://provider/…" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} />
                    <span className="hint">A secret-store reference — never a raw key. This is a manual, operator-provisioned value.</span>
                  </div>
                  <button className="btn primary" disabled={busy} onClick={() => void doConnect()}>Save</button>
                </div>
              ) : (
                <div className="stack tight">
                  <div><button className="btn primary" disabled={busy} onClick={() => void doConnect()}>Connect {integration?.provider?.replace(/_/g, " ")} →</button></div>
                  <span className="hint">Manual step: real Google needs the operator to set <span className="mono">GOOGLE_CLIENT_ID</span> (see <span className="mono">.env.example</span>); otherwise a dev connector is used.</span>
                </div>
              )}
            </div>
          )
        ) : null}

        {/* DONE — skill (no connector) fully set up */}
        {enabled && integration === null ? (
          <div className="note allow">All set — this package is enabled and its tools are available to the members you allowed.</div>
        ) : null}

        {note ? <div className="note deny">{note}</div> : null}
      </div>
    </div>
  );
}
