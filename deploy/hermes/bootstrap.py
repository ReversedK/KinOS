#!/usr/bin/env python3
"""
Bootstrap a Hermes profile config for use as a KinOS Harness (ADR-008).

Runs once per container start, after Hermes' s6 cont-init has created/migrated
~/.hermes/config.yaml (HERMES_HOME=/opt/data). It makes the config self-consistent
for local-first inference behind KinOS:

  * points the model at the host's Ollama over its OpenAI-compatible endpoint
    (Hermes' `ollama` provider speaks /v1; a bare :11434 base_url 404s), with a
    context_length override because Hermes requires >=64K and Ollama may report a
    smaller window than the model's real one;
  * enables the `api_server` gateway platform so `hermes gateway run` exposes the
    OpenAI-compatible server on :8642 that KinOS' AgentRuntime (OpenAI adapter,
    KINOS_RUNTIME=hermes) calls. The Bearer key comes from API_SERVER_KEY (env).

Idempotent: safe to re-run. Model backend is overridable via env so a deployment
can point Hermes at a different Ollama/model without editing this file:
  HARNESS_MODEL (default gemma4-128k), HARNESS_OLLAMA_URL
  (default http://host.docker.internal:11434/v1), HARNESS_MODEL_CONTEXT (65536,
  Hermes' minimum; higher costs more KV cache and a slower cold start).

This configures the SINGLE default `hermes-agent` profile (Harness-as-inference).
Per-agent projected profiles + the Sphere-MCP tool callback (the full RFC-007
governed loop) are layered on top by KinOS' runtime.config.project, not here.
"""
import os
import re

CONFIG = os.path.join(os.environ.get("HERMES_HOME", "/opt/data"), "config.yaml")

MODEL = os.environ.get("HARNESS_MODEL", "gemma4-128k")
OLLAMA_URL = os.environ.get("HARNESS_OLLAMA_URL", "http://host.docker.internal:11434/v1")
CONTEXT = os.environ.get("HARNESS_MODEL_CONTEXT", "65536")

model_block = (
    "model:\n"
    f"  default: {MODEL}\n"
    "  provider: ollama\n"
    f"  base_url: {OLLAMA_URL}\n"
    f"  context_length: {CONTEXT}\n"
)

api_server_block = (
    "\n# KinOS Harness: OpenAI-compatible server KinOS calls (ADR-008). Key via env.\n"
    "gateway:\n"
    "  platforms:\n"
    "    api_server:\n"
    "      enabled: true\n"
    "      extra:\n"
    "        host: 0.0.0.0\n"
    "        port: 8642\n"
)

try:
    src = open(CONFIG).read()
except FileNotFoundError:
    raise SystemExit(f"[harness-bootstrap] {CONFIG} not found — did Hermes cont-init run?")

# Replace the top-level model: block (provider/model/base_url the harness runs on).
if re.search(r"^model:\n(?:  .*\n)+", src, flags=re.M):
    src = re.sub(r"^model:\n(?:  .*\n)+", model_block, src, count=1, flags=re.M)
else:
    src = model_block + src

# Enable the api_server platform once (idempotent: skip if already present).
if "api_server:" not in src:
    src += api_server_block

# Quiet the background curator/auxiliary LLM: it defaults to cloud providers
# (openrouter/nous) we don't configure here, so it spams auth/credit warnings and
# wastes retries on every turn. It is memory housekeeping, not inference — off by
# default for a local-first Harness. Flip the seeded `curator.enabled: true`.
src = re.sub(r"^(curator:\n(?:  .*\n)*?  enabled:) true$", r"\1 false", src, count=1, flags=re.M)

open(CONFIG, "w").write(src)
print(f"[harness-bootstrap] configured {CONFIG}: model={MODEL} via {OLLAMA_URL}, api_server on :8642")
