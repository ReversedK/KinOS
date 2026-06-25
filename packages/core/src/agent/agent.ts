/**
 * Agent — a digital representative of a Member or a Sphere (domain-model.md).
 * "An Agent represents exactly one owner and never claims to be that owner";
 * agent identity is distinct from member and Sphere identity.
 *
 * Lifecycle: entity-lifecycle.md → Agent lifecycle. Disabling an agent does not
 * delete memory; changing runtime/model does not create a new agent identity.
 *
 * Pure domain: no I/O, no provider/runtime imports. The model preference is an
 * advisory tag (e.g. an Ollama model); it is replaceable and owns nothing.
 */

export type AgentOwnerType = "member" | "sphere";

export type AgentState =
  | "configured"
  | "active"
  | "paused"
  | "disabled"
  | "exported"
  | "deleted";

export interface Agent {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerType: AgentOwnerType;
  readonly sphereId: string;
  readonly name: string;
  /** Advisory model tag; swapping it must be "boring" (no identity change). */
  readonly modelPreference?: string;
  /** Capability names the agent may request (still policy-checked per call). */
  readonly enabledCapabilities: readonly string[];
  readonly state: AgentState;
}

export interface CreateAgentInput {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerType: AgentOwnerType;
  readonly sphereId: string;
  readonly name: string;
  readonly modelPreference?: string;
  readonly enabledCapabilities?: readonly string[];
}

export function createAgent(input: CreateAgentInput): Agent {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("Agent name must not be empty");
  }
  if (input.id === input.ownerId) {
    throw new Error("Agent identity must be distinct from its owner");
  }
  return {
    id: input.id,
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    sphereId: input.sphereId,
    name,
    ...(input.modelPreference !== undefined ? { modelPreference: input.modelPreference } : {}),
    enabledCapabilities: input.enabledCapabilities ? [...input.enabledCapabilities] : [],
    state: "configured",
  };
}

export function enableCapability(agent: Agent, capabilityName: string): Agent {
  if (agent.enabledCapabilities.includes(capabilityName)) return agent;
  return { ...agent, enabledCapabilities: [...agent.enabledCapabilities, capabilityName] };
}

export function disableCapability(agent: Agent, capabilityName: string): Agent {
  return {
    ...agent,
    enabledCapabilities: agent.enabledCapabilities.filter((c) => c !== capabilityName),
  };
}

export function activateAgent(agent: Agent): Agent {
  return { ...agent, state: "active" };
}

export function pauseAgent(agent: Agent): Agent {
  return { ...agent, state: "paused" };
}

/** Disable an agent. Blocks future use; does not delete memory (entity-lifecycle). */
export function disableAgent(agent: Agent): Agent {
  return { ...agent, state: "disabled" };
}

/**
 * Change the model preference. The agent identity is unchanged — model
 * replacement must be "boring": no new identity, no memory/policy change
 * (coding principle 9).
 */
export function changeModelPreference(agent: Agent, modelPreference: string): Agent {
  return { ...agent, modelPreference };
}
