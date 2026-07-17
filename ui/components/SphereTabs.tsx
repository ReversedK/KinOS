"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * Workspace section nav. Replaces the old anchor-into-one-scroll rail: each entry
 * is a real route that loads only its section, so an operator navigates focused
 * views instead of scrolling one long document. Presentational — it decides
 * nothing (coding principle 1); it preserves the acting `?actor=` identity across
 * sections so switching tabs never silently changes who you are acting as.
 */
const SECTIONS = [
  ["", "Overview", "01"],
  ["members", "Members", "02"],
  ["agents", "Agents", "03"],
  ["access", "Access", "04"],
  ["data", "Data", "05"],
  ["settings", "Settings", "06"],
  ["activity", "Activity", "07"],
] as const;

export function SphereTabs({ sphereId }: { sphereId: string }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const base = `/spheres/${encodeURIComponent(sphereId)}`;
  const query = search.get("actor") ? `?actor=${encodeURIComponent(search.get("actor") as string)}` : "";

  return (
    <nav className="sphere-nav" aria-label="Sphere workspace">
      <span className="eyebrow">Workspace</span>
      {SECTIONS.map(([slug, label, index]) => {
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
