const ITEMS = [
  ["overview", "Overview", "01"],
  ["members", "Members", "02"],
  ["agents", "Agents", "03"],
  ["approvals", "Approvals", "04"],
  ["permissions", "Permissions", "05"],
  ["runtime", "Runtime", "06"],
  ["connectors", "Connectors", "07"],
  ["calendar", "Calendar", "08"],
  ["notes", "Notes", "09"],
  ["activity", "Activity", "10"],
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
