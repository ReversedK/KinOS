# KinOS dev/run environment.
# ADR-006 mandates TypeScript on Node.js; this image is the container that
# provides that runtime so development and CI never depend on a host toolchain.
# build-essential + python3 are present so native modules (e.g. the SQLite
# persistence adapter) can compile in later iterations.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Default to an idle container; commands are run via `docker compose run`.
CMD ["sleep", "infinity"]
