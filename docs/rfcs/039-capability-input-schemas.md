# RFC-039 — Declare capability input schemas (so agents don't guess arguments)

## Status

Accepted

## Summary

The Sphere MCP advertised every tool with the same permissive schema
(`{ type: "object", additionalProperties: true }`), so an agent had no way to know a
capability's actual arguments. Optional-argument tools happened to work; a tool with
a **required** argument did not — `document.summarize` (needs `documentId`) failed
repeatedly because the agent guessed the argument and the handler rejected it.
Declare a real input JSON Schema per capability in the catalog and surface it as the
tool's `inputSchema`.

## Motivation

Observed from an agent's own reasoning (Hermes TUI): "`document search`: lists
documents… `document summarize`: (failed)… the summarize tool is broken / requires a
different input format." `document.search` "worked" only because its `query` is
optional; `document.summarize` requires `documentId`, which the agent never learned
from the empty schema, so it never sent the right argument. The domain
`capability-catalog.md` already specifies that each capability "declares input and
output schemas" — the code simply hadn't.

## Proposal

- **`Capability` gains an optional `inputSchema`** (a JSON Schema object). The
  catalog attaches one to each capability that takes arguments — `document.search`
  ({query?}), `document.summarize` ({documentId!}), `memory.search/capture/share/
  revoke_share`, `sphere.note.create` / `sphere.project.create`, `calendar.read` /
  `calendar.create_event`, `message.send`, `payment.execute`. Each declares the
  properties, descriptions, and which are `required`.
- **The Sphere MCP `tools/list`** advertises `catalog.inputSchema` for a tool,
  falling back to the permissive object only for capabilities with free-form input.
  Nothing else changes: the gateway still passes the arguments through to the binding;
  the schema is guidance for the caller, not a new authorization surface.

## Domain impact

One optional field on `Capability`; a schema map in the catalog; the MCP tools/list
uses it. No new capability, policy, event, or entity. Every governed check
(policy, scope, approval) is unchanged — this only tells the agent what to send.

## Security and privacy impact

- **No new authority or surface.** The schema is descriptive metadata; the Policy
  Engine and RFC-027 scope still gate every call, and the handler still validates its
  own input (a missing/invalid argument is still refused — now surfaced cleanly by
  RFC-028 rather than looking like a broken tool).
- **No content in the schema.** Schemas describe argument shapes (an id, a query),
  never private data; audit and privacy rules are untouched.
- **Fewer failed calls.** Correct schemas reduce wasted, malformed tool calls (an
  agent looping on a rejected argument), which is a small robustness/cost win.

## Alternatives considered

- **Put the argument hints only in the tool `description`.** Rejected — MCP clients
  consume the structured `inputSchema` to build/validate calls; prose alone is not
  reliably actioned, and a `required` array is exactly what the agent was missing.
- **Infer schemas from the local handlers.** Rejected — handlers are one binding of
  a capability (a provider may back it differently); the agent-facing input contract
  belongs to the capability (the catalog), per capability-catalog.md.

## Acceptance criteria

- `defaultCapabilityCatalog().get("document.summarize").inputSchema` requires
  `documentId`; `document.search` declares an optional `query`.
- The Sphere MCP `tools/list` advertises those schemas (not the empty object) for a
  capability that has one.
- An agent asked to summarize a document sends `documentId` and succeeds (the tool no
  longer "requires a different input format").
- Every policy/scope/approval check is unchanged.
