# syntax=docker/dockerfile:1

# A glibc-based image is required, not Alpine: @temporalio/core-bridge (the Rust core
# the worker loads) ships a prebuilt x86_64-unknown-linux-gnu binary, which cannot be
# loaded against musl — the worker dies with ERR_DLOPEN_FAILED on ld-linux-x86-64.so.2.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- build stage ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- production dependencies ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl is used by the compose health check for the API container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 3000

# Overridden by the worker service in docker-compose.yml.
CMD ["node", "dist/index.js"]
