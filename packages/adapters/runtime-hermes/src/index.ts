// The Hermes adapter package holds the RFC-007 config-projection writer
// (Hermes realizes the provider-agnostic RuntimeConfigProjection as a profile).
// Hermes-as-inference is served by @kinos/runtime-openai pointed at Hermes'
// OpenAI-compatible API server (/v1) — there is no bespoke Hermes runtime.
export * from "./hermes-config.js";
