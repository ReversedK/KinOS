# RFC-005 — Agent Chat Sessions and Conversation History

## Status

Accepted.

## Summary

KinOS introduces **Session** (a conversation between a member and an agent) and
**Message** as a new domain concept, distinct from canonical memory (ADR-002) and
from the audit log (event-model.md). A session holds the running transcript so a
member can keep talking to their agent and resume past conversations. Sessions are
**private to their owner by default**, policy-scoped on read, and are **not** the
audit trail. Turning something said in a chat into durable knowledge is an
**explicit promotion** to a canonical MemoryItem — the model never owns memory.

## Motivation

results-contract §16 lists "local chat" as a core offline function, and the
product needs a member to talk to their Hermes agent with **session history**.
ADR-002 defines canonical memory as deliberate MemoryItems, not raw chat
transcripts; the audit model (coding principle 7) is security-facts-only and must
not absorb conversation content. So there is no accepted home for a chat transcript
today, and conflating it with either memory or audit would break their contracts.
This RFC defines the missing concept and its boundaries.

## Proposal

### New entities: Session and Message

```ts
type Session = {
  id: string;
  sphereId: string;
  agentId: string;        // the agent being talked to (member or, later, Sphere persona)
  ownerId: string;        // the acting member who owns this conversation
  title: string;          // human label; may be derived
  state: 'active' | 'archived' | 'deleted';
  createdAt: string;
  updatedAt: string;
};

type Message = {
  id: string;
  sessionId: string;
  role: 'user' | 'agent';     // conversational role only — never an authorization role
  content: string;            // conversational content (private)
  createdAt: string;
  correlationId?: string;     // links to any capability calls made during the turn
};
```

`role` is conversational, not a permission. System/instruction text is runtime
construction, not authorization, and is never stored as a grant (coding principle 2).

### Sessions are private and policy-scoped

- A session is **private to its owner by default**, with the same visibility
  semantics as a private MemoryItem (ADR-002): another member or a minor cannot
  read someone else's session. Read is policy-scoped through the Policy Engine
  (coding principle 4) — the resolver asks policy, it does not decide on its own.
- Supervision of minors follows existing rules: guardianship may permit oversight,
  but supervision is not total surveillance (invariant 8); how/whether a guardian
  sees a minor's sessions is governed by policy, not granted implicitly.

### Transcript is not audit, and not canonical memory

- The **transcript** is conversational content and stays private; the **audit log**
  remains security-facts-only and must never copy message bodies (coding principle 7;
  invariant 16). The two are separate stores with separate lifecycles.
- A session is short-term continuity, not durable knowledge. Long-term recall is an
  **explicit promotion**: "remember this" creates a canonical MemoryItem (ADR-002),
  policy-governed like any memory. Canonical memory is the record; embeddings over
  sessions, if added, are derived and regenerable (coding principle 5) and never an
  authorization boundary.

### Runtime mapping (Hermes is the reference, not a dependency)

A chat turn runs the standard pipeline:

```text
member sends a message in a session
  -> Identity resolved (the session owner)
  -> Policy Engine scopes readable memory + this owner's own session history
  -> prompt built only from authorized memory + authorized history (principle 4)
  -> AgentRuntime.generate (ADR-001 "run agent sessions") via the Sphere's RuntimeProfile (RFC-004)
  -> any capability the agent requests goes through the full capability pipeline
     (policy re-check, binding, approval) under a correlation id
  -> the reply is appended to the session
```

The Session entity is **runtime-independent**: Hermes is the reference runtime, but
replacing it changes nothing about sessions, memory or policy (coding principle 9;
invariant 28). Chat inference through a cloud provider is an external transfer
governed by RFC-004.

### Retention and deletion

- The owner can delete a session (privacy-model.md right to delete). Deletion
  removes the transcript but **does not** delete MemoryItems already promoted from
  it, nor audit facts (revocation/deletion blocks the future, not the past —
  invariant 5).
- Default retention is "keep until the owner deletes"; a Sphere may configure a
  retention policy. Retention choices are themselves audited as security facts.

### UI

The admin/config UI (RFC-003) gains a chat view and a session list: start a new
conversation, resume a past session, rename, archive, delete. The UI shows only
the owner's own sessions (subject to policy); it never exposes another member's
private transcript.

## Domain impact

- New entities **Session** and **Message** added to `domain-model.md` and
  `entity-lifecycle.md` (lifecycle: active → archived → deleted).
- New capabilities `chat.send` (medium; the agent's own capability requests within
  a turn are governed separately), `session.read`, `session.list`, `session.delete`
  (owner-scoped), with minor-safety defaults.
- Defined relationship to **MemoryItem**: sessions are short-term; promotion to
  memory is explicit and governed (ADR-002).
- New persistence: a Session/Message repository port in the core + a SQLite adapter
  table, separate from canonical memory and from the audit sink.

## Security and privacy impact

- **Private by default** (invariants 4, 7): sessions are owner-private and
  policy-scoped on read.
- **Audit minimality** (invariant 16; coding principle 7): transcripts never enter
  the audit log; the audit log never stores message content.
- **Filter before runtime** (coding principle 4): only authorized memory and the
  owner's own history reach the prompt; the prompt is not a boundary.
- **Minor protection / supervision** (invariant 8): minors' sessions are protected;
  guardian oversight is policy-governed, not implicit, and is not total surveillance.
- **External transfer** (invariant 14): cloud chat inference is governed and audited
  per RFC-004.
- **Right to delete** (privacy-model.md): owners can delete sessions; promoted
  memory and audit facts persist (invariant 5).

## Alternatives considered

- **Store transcripts as canonical MemoryItems.** Rejected: bloats canonical memory
  with low-value chatter, blurs the deliberate-memory model (ADR-002), and risks
  pulling content toward the audit/retention rules meant for security facts.
- **Put transcripts in the audit log.** Rejected: turns the audit trail into a data
  leak (invariant 16; coding principle 7).
- **Stateless chat with no history.** Rejected: the product explicitly requires
  session history; continuity is the feature.
- **One shared transcript per agent across members.** Rejected: violates
  per-member privacy and identity separation (invariants 8, 19).

## Open questions

- Cross-session recall: surfacing prior sessions via embeddings/search while keeping
  embeddings derived and policy-scoped.
- Compaction/summarization of long sessions (and whether a summary is a MemoryItem
  or session metadata).
- Sphere-agent (persona) sessions — ADR-005 layer 2, deferred; this RFC covers
  member-owned sessions first.
- The precise governed mechanism for guardian oversight of a minor's sessions
  (consent, visibility scope) without enabling surveillance.

## Acceptance criteria

- Session and Message are defined as domain entities with a lifecycle and a
  repository port; `domain-model.md` and `entity-lifecycle.md` are updated.
- Sessions are owner-private by default and read is policy-scoped; another member or
  a minor cannot read a session they do not own.
- Transcripts are stored separately from canonical memory and from the audit log;
  no message content appears in audit events.
- A chat turn runs the full pipeline (policy-scoped memory + owner history → runtime
  → governed capability calls under a correlation id).
- Promoting a chat fact to long-term memory creates a governed MemoryItem; deleting
  a session does not delete promoted memory or audit facts.
- The UI shows only the owner's own sessions and never another member's transcript.
