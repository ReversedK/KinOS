"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CLIENT_API_BASE } from "../lib/api";

const LINKS = [
  { href: "/", label: "Spheres", match: (p: string) => p === "/" || p.startsWith("/spheres") },
  { href: "/approvals", label: "Approvals", match: (p: string) => p.startsWith("/approvals") },
];

/**
 * The console shell's top bar: brand, primary navigation and a live API health
 * indicator. Purely presentational — it triggers no governed action and decides
 * nothing (coding principle 1).
 */
export function TopNav() {
  const path = usePathname() ?? "/";
  const [ok, setOk] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch(`${CLIENT_API_BASE}/spheres`, { cache: "no-store" });
        if (alive) setOk(res.ok);
      } catch {
        if (alive) setOk(false);
      }
    };
    void ping();
    const t = setInterval(() => void ping(), 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const health =
    ok === undefined
      ? { color: "var(--ink-3)", label: "checking" }
      : ok
        ? { color: "var(--allow)", label: "api online" }
        : { color: "var(--deny)", label: "api offline" };

  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="glyph">◈</span>
        <span>
          KinOS <small>operator console</small>
        </span>
      </a>
      <nav className="nav">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={`navlink${l.match(path) ? " active" : ""}`}>
            {l.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      <span className="badge" title={`KinOS API — ${health.label}`}>
        <span className="status-dot" style={{ color: health.color }} />
        {health.label}
      </span>
    </header>
  );
}
