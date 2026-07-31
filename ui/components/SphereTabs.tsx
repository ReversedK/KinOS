"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * Workspace section nav. Replaces the old anchor-into-one-scroll rail: each entry
 * is a real route that loads only its section, so an operator navigates focused
 * views instead of scrolling one long document. Presentational — it decides
 * nothing (coding principle 1); it preserves the acting `?actor=` identity across
 * sections so switching tabs never silently changes who you are acting as.
 */
const SECTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["", "Overview", "01"],
  ["members", "Members", "02"],
  ["agents", "Agents", "03"],
  ["policies", "Policy Engine", "04"],
  ["access", "Access", "05"],
  ["data", "Data", "06"],
  ["settings", "Settings", "07"],
  ["activity", "Activity", "08"],
];

/**
 * The Documents section (RFC-048) is package-gated: it only appears once the
 * `documents` package is installed in this Sphere. The layout resolves that
 * (a governed read) and passes `hasDocuments`; the nav stays presentational.
 */
export function SphereTabs({ sphereId, hasDocuments = false }: { sphereId: string; hasDocuments?: boolean }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const base = `/spheres/${encodeURIComponent(sphereId)}`;
  const query = search.get("actor") ? `?actor=${encodeURIComponent(search.get("actor") as string)}` : "";

  const sections = hasDocuments ? [...SECTIONS, ["documents", "Documents", "09"] as const] : SECTIONS;

  return (
    <nav className="sphere-nav" aria-label="Sphere workspace">
      <span className="eyebrow">Workspace</span>
      {sections.map(([slug, label, index]) => {
        const href = slug === "" ? base : `${base}/${slug}`;
        const active = slug === "" ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <a key={slug} href={`${href}${query}`} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <span>{index}</span>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
