/**
 * KinOS domain core.
 *
 * Pure TypeScript: this package must not import any provider, runtime,
 * framework or I/O dependency (ADR-001, coding principle 1). It defines the
 * domain, ports and policy logic; adapters live outside it.
 */

/** Version of the domain contract this core implements. */
export const CORE_CONTRACT_VERSION = "0.1.0";

export * from "./identity/identity.js";
export * from "./sphere/member.js";
export * from "./sphere/sphere.js";
export * from "./policy/types.js";
export * from "./policy/engine.js";
export * from "./memory/memory.js";
export * from "./memory/resolver.js";
export * from "./agent/agent.js";
