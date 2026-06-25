/**
 * Local capability executor adapter.
 *
 * Implements @kinos/core's CapabilityExecutor port by dispatching a resolved
 * binding to a registered handler keyed by the binding's provider-specific
 * `runtimeToolName`. Provider/runtime code lives here, outside the domain core
 * (coding principle 8); it decides no permissions — by the time execute() is
 * called the capability has already passed the policy double-check.
 *
 * Failure containment (ADR-001): an unknown handler throws, surfacing as a
 * failed capability execution rather than a silent success.
 */

import type { AgentRuntime, CapabilityBinding, CapabilityExecutor } from "@kinos/core";

export type CapabilityHandler = (
  input: unknown,
  binding: CapabilityBinding,
) => Promise<unknown>;

export class LocalCapabilityExecutor implements CapabilityExecutor {
  constructor(private readonly handlers: ReadonlyMap<string, CapabilityHandler>) {}

  async execute(binding: CapabilityBinding, input: unknown): Promise<unknown> {
    const handler = this.handlers.get(binding.runtimeToolName);
    if (handler === undefined) {
      throw new Error(`No local handler for runtime tool '${binding.runtimeToolName}'`);
    }
    return handler(input, binding);
  }
}

export interface ModelBackedHandlerOptions {
  readonly model: string;
  /** Optional system framing; never a place for authorization (principle 2). */
  readonly system?: string;
}

/**
 * Build a handler that routes a capability through an AgentRuntime. The input
 * is already authorized (the runtime is a second line of defense, not the
 * first). Useful for capabilities like message.draft or document.summarize.
 */
export function modelBackedHandler(
  runtime: AgentRuntime,
  options: ModelBackedHandlerOptions,
): CapabilityHandler {
  return async (input: unknown) => {
    const content = typeof input === "string" ? input : JSON.stringify(input);
    const res = await runtime.generate({
      model: options.model,
      messages: [
        ...(options.system !== undefined
          ? [{ role: "system" as const, content: options.system }]
          : []),
        { role: "user" as const, content },
      ],
    });
    return { content: res.content, model: res.model };
  };
}
