const ITEMS = [
  ["overview", "Overview", "01"],
  ["members", "Members", "02"],
  ["agents", "Agents", "03"],
  ["permissions", "Permissions", "04"],
  ["runtime", "Runtime", "05"],
  ["connectors", "Connectors", "06"],
  ["calendar", "Calendar", "07"],
  ["notes", "Notes", "08"],
] as const;

export function SphereNav() {
  return (
    <nav className="sphere-nav" aria-label="Sphere administration">
      <span className="eyebrow">Administration</span>
      {ITEMS.map(([id, label, index]) => (
        <a key={id} href={`#${id}`}>
          <span>{index}</span>
          {label}
        </a>
      ))}
    </nav>
  );
}
