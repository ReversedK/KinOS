/**
 * Friendly, human-facing metadata for capability names — a single source of truth
 * for the console so an action reads as "Create calendar events" (with a colour-coded
 * category) rather than a raw `calendar.create_event`. Presentational only; the
 * capability name is still the machine identity shown alongside.
 */

const LABELS: Record<string, string> = {
  "calendar.read": "Read the calendar",
  "calendar.create_event": "Create calendar events",
  "document.search": "Search documents",
  "document.summarize": "Summarize a document",
  "memory.search": "Search notes",
  "memory.capture": "Write a private note",
  "memory.share": "Share a note",
  "memory.revoke_share": "Un-share a note",
  "sphere.note.create": "Write a shared note",
  "sphere.project.create": "Create a shared project",
  "message.send": "Send a message",
  "payment.execute": "Make a payment",
  "native.web": "Search the web",
  "native.cron": "Schedule tasks",
  "native.media": "Use media tools",
  "native.browser": "Drive a web browser",
  "native.delegate": "Spawn subagents",
  "runtime.config.project": "Project an agent's runtime config",
  "runtime.session.backup": "Back up agent runtime state",
  "runtime.session.restore": "Restore agent runtime state",
  "sphere.export": "Export the Sphere",
  "sphere.archive": "Archive the Sphere",
  "member.invite": "Invite a member",
  "agent.create": "Deploy an agent",
};

/** A friendly action label for a capability (falls back to a de-dotted name). */
export function capabilityLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, " ").replace(/\./g, " · ");
}

export interface CapabilityCategory {
  readonly key: string;
  readonly title: string;
  readonly tile: string;
  readonly glyph: string;
}

const CATEGORIES: readonly CapabilityCategory[] = [
  { key: "calendar", title: "Calendar", tile: "calendar", glyph: "📅" },
  { key: "document", title: "Documents", tile: "docs", glyph: "📄" },
  { key: "memory", title: "Notes & memory", tile: "docs", glyph: "🗒" },
  { key: "sphere", title: "Shared workspace", tile: "agent", glyph: "◫" },
  { key: "message", title: "Messaging", tile: "message", glyph: "✉" },
  { key: "payment", title: "Payments", tile: "payment", glyph: "❖" },
  { key: "native", title: "Harness abilities", tile: "harness", glyph: "⚙" },
  { key: "runtime", title: "Runtime", tile: "harness", glyph: "⚙" },
  { key: "agent", title: "Agents", tile: "agent", glyph: "◈" },
  { key: "member", title: "Members", tile: "agent", glyph: "☺" },
  { key: "other", title: "Other", tile: "store", glyph: "◈" },
];

/** The category (colour-coded tile + glyph) a capability belongs to. */
export function capabilityCategory(name: string): CapabilityCategory {
  const prefix = name.split(".")[0] ?? "other";
  const key = CATEGORIES.some((c) => c.key === prefix) ? prefix : "other";
  return CATEGORIES.find((c) => c.key === key)!;
}
