"use client";

import "@xterm/xterm/css/xterm.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { CLIENT_API_BASE, openHarnessTerminal, type ActingSubject } from "../../../../lib/api";

/**
 * Real-condition agent testing (ADR-008 §6): a terminal attached to the agent's
 * own governed Hermes profile.
 *
 * This replaces the old direct-inference chat bench, which ADR-008 reclassified
 * as test-mode only because it never exercised the Harness loop. Here the agent
 * really runs inside the Harness: on the model KinOS decided (RFC-004/009,
 * projected into its profile) and reaching capabilities only through the Sphere
 * MCP, where every call is policy-checked again.
 *
 * The console decides nothing. It asks the API to authorize an attach; the API
 * runs the Policy Engine and returns a single-use ticket, and the terminal is
 * only opened if that succeeded. A denial is a governed outcome, shown as-is.
 */
export function Tui({
  sphereId,
  agents,
  actor,
}: {
  sphereId: string;
  agents: readonly { id: string; name: string }[];
  actor: ActingSubject;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [status, setStatus] = useState<{ tone: string; text: string }>();
  const [attached, setAttached] = useState(false);
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const teardownRef = useRef<() => void>();

  const detach = useCallback(() => {
    teardownRef.current?.();
    teardownRef.current = undefined;
    setAttached(false);
  }, []);

  // Detach when the component goes away: the session must not outlive the tab.
  useEffect(() => () => teardownRef.current?.(), []);

  async function attach(): Promise<void> {
    if (agentId === "") return;
    setBusy(true);
    setStatus(undefined);
    try {
      // Governed: the Policy Engine decides before any terminal exists.
      const granted = await openHarnessTerminal(CLIENT_API_BASE, sphereId, agentId, actor);
      if (granted.ticket === undefined) {
        setStatus({ tone: "deny", text: granted.message ?? "Attach was denied." });
        return;
      }

      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      const host = hostRef.current;
      if (host === null) return;
      host.replaceChildren();

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        theme: { background: "#0b0d10", foreground: "#d7dce3" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();

      const ws = new WebSocket(`${harnessWsBase()}/?ticket=${encodeURIComponent(granted.ticket)}`);
      ws.onopen = () => {
        setAttached(true);
        // The PTY needs the real geometry; the default 80x24 would clip the TUI.
        ws.send(`\x00resize:${term.rows},${term.cols}`);
      };
      ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
      ws.onerror = () => setStatus({ tone: "deny", text: "The Harness terminal is unreachable. Is the hermes service up?" });
      ws.onclose = (e) => {
        setAttached(false);
        if (e.reason !== "") setStatus({ tone: "deny", text: e.reason });
        term.write("\r\n\x1b[90m— detached —\x1b[0m\r\n");
      };

      const onData = term.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(data));
      const onResize = () => {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) ws.send(`\x00resize:${term.rows},${term.cols}`);
      };
      window.addEventListener("resize", onResize);

      teardownRef.current = () => {
        window.removeEventListener("resize", onResize);
        onData.dispose();
        ws.close();
        term.dispose();
        host.replaceChildren();
      };
    } catch (e) {
      setStatus({ tone: "deny", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field grow">
          <label>Agent</label>
          <select className="select" value={agentId} disabled={attached} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.id}
              </option>
            ))}
          </select>
        </div>
        {attached ? (
          <button className="btn" onClick={detach}>
            Detach
          </button>
        ) : (
          <button className="btn" disabled={busy || agentId === ""} onClick={() => void attach()}>
            {busy ? <span className="spin" /> : null} Attach terminal
          </button>
        )}
      </div>
      {status ? <div className={`note ${status.tone}`}>{status.text}</div> : null}
      <div ref={hostRef} className="tui-host" />
      <span className="hint">
        The session runs inside the agent&apos;s governed Hermes profile: the model KinOS decided, and only its policy-authorized
        capabilities — each call re-checked at the Sphere MCP. Attaching is not authorizing.
      </span>
    </div>
  );
}

/**
 * The bridge is a websocket on the Hermes container, not an HTTP route on the
 * API, so it cannot go through the console's same-origin API proxy.
 */
function harnessWsBase(): string {
  const configured = process.env["NEXT_PUBLIC_KINOS_TUI_URL"];
  if (configured !== undefined && configured !== "") return configured;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:8788`;
}
