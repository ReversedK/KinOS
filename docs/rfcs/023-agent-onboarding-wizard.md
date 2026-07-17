# RFC-023 — Agent onboarding wizard

## Status

Accepted

## Summary

A guided flow in the operator console for standing up a new agent: **identity →
scope → review & project → reachable**. It composes existing governed operations
into one coherent path and ends at an honest handoff: KinOS has made the agent
*governed and reachable* (a projected Hermes profile + a per-agent token); connecting
a messaging channel (WhatsApp/Telegram/…) is done **in Hermes**, because the channel
is Hermes' concern, not KinOS's (RFC-007).

## Motivation

The steps to get a working agent already exist but are scattered across the console:
deploy on the Agents section, then separately find "Project to Hermes" on the agent
card, with nothing telling a new operator the sequence or that projection is what
makes the agent reachable. The result is a pile of buttons, not a path.

This RFC adds no capability — it makes the *existing* governed sequence legible:
deploy the agent, choose its capability scope, see what policy actually authorizes,
project its Hermes profile, and finish at a clear "reachable — connect a channel in
Hermes" step.

## Non-goals (explicitly)

- **No channel setup in KinOS.** RFC-007 §"Messaging channels" is binding: "The
  channel↔identity binding is handled by Hermes … KinOS does not govern the
  channel." Blocking or owning channels was considered and rejected there. The
  wizard's final step is a *documented handoff* to Hermes, never a form that writes
  channel credentials into KinOS.
- **No new domain, capability, endpoint, or store.** This is UI orchestration only.

## Proposal

A `AgentWizard` client component on the Agents section, replacing the one-shot
deploy form as the primary "＋ Deploy agent" path. Four steps, each triggering an
already-accepted governed operation (the wizard decides nothing; the Policy Engine
does):

1. **Identity** — choose the owner (a Sphere member) and name the agent.
2. **Scope** — pick the agent-facing capability scope (deny-by-default reminder:
   scope is a *request surface*, every call is still policy-checked). Committing this
   step calls `agent.create` (RFC-008) and captures the new agent id.
3. **Review & project** — show the governed runtime projection preview
   (`runtime.config.project` dry-run, RFC-007): provider/model, the single Sphere-MCP
   gateway, auth-by-reference, and **allowed tools = what policy actually authorizes**
   set against the requested scope, so the operator sees the gap between *requested*
   and *granted*. A "Project to Hermes" action then commits `runtime.config.project`,
   writing the agent's Hermes profile + provisioning its per-agent token.
4. **Reachable** — a plain-language finish: the agent now has a governed Hermes
   profile and its own token; to let a person reach it over a messaging app, connect
   a channel **in Hermes**. States the division of responsibility (KinOS governs what
   the agent may do; Hermes routes the channel) and points to Hermes' channel docs.

Each step surfaces the governed outcome (executed / denied / approval) exactly as the
existing components do. A denial at any step is a governed result, shown in place.

## Domain impact

None. The wizard calls `agent.create` / `agent.update_config` (RFC-008),
`model.set` (RFC-009) and `runtime.config.project` (RFC-007) through the existing
same-origin proxy. No capability, policy, entity, or event is added.

## Security and privacy impact

- **No authorization moves to the UI.** Every step is the existing governed call;
  the wizard triggers, the Policy Engine decides (coding principle 1). Deploying an
  agent and choosing a scope is a *request surface*, not a grant.
- **KinOS stays out of the channel credential path.** The channel step writes
  nothing and holds no channel secret — it is text pointing to Hermes. This is the
  whole reason the wizard is safe: it does not pull channel↔identity into KinOS,
  which RFC-007 rejected.
- **Per-agent token boundary preserved.** Projection provisions the per-agent token
  exactly as `runtime.config.project` does today; the wizard adds no new principal.

## Alternatives considered

- **A channel-setup wizard in KinOS** (the original ask). Rejected: RFC-007 assigns
  the channel↔identity binding to Hermes and rejects KinOS owning it; such a wizard
  would be a passthrough that puts channel credentials through KinOS for zero
  governance gain and re-opens a closed decision.
- **Leave the steps scattered.** Rejected: the operations are governed but the path
  is not legible, which is a real UX gap for standing up the first agent.
- **A modal wizard.** Deferred: the console has no modal primitive; an inline stepper
  matches the existing expand-in-place pattern (DeployAgent, AgentConfig).

## Open questions

- Inline "invite a member" if the Sphere has none yet (today: the wizard links to
  the Members section). Deferred — keeps step 1 simple.
- Surfacing live channel/reachability status from Hermes (read-only) once Hermes
  exposes it — still not KinOS governing the channel, only reflecting it.

## Acceptance criteria

- The Agents section offers a guided deploy path: identity → scope → review &
  project → reachable.
- Step 2 deploys via `agent.create` and captures the agent id; step 3 previews the
  projection and commits `runtime.config.project`; step 4 is a Hermes handoff that
  writes nothing.
- A denial at any step is shown in place as a governed outcome.
- No new capability/endpoint; the channel step holds no credential.
- Verified end-to-end against the running stack: deploy → project → reachable.
