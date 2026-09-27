# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Base runtime environment
# =============================================================================
FROM node:24-bookworm-slim AS base

WORKDIR /app

# Install security certificates, dumb-init (PID 1 process supervisor) and curl (for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Stage 2: Dependencies installation (cached layer)
# =============================================================================
FROM base AS dependencies

# Copy package manifests across workspaces needed by the API
COPY package.json package-lock.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Create a stub manifest for mobile workspace to satisfy npm package-lock without downloading mobile dependencies
RUN mkdir -p apps/mobile && \
    echo '{"name": "@fieldops/mobile", "version": "0.0.0", "private": true}' > apps/mobile/package.json

# Install dependencies for API and its packages (skipping scripts during install)
RUN npm ci \
    --workspace=@fieldops/api \
    --workspace=@fieldops/shared \
    --workspace=@fieldops/types \
    --workspace=@fieldops/config \
    --include-workspace-root \
    --ignore-scripts

# =============================================================================
# Stage 3: Builder (Compile TypeScript and generate Prisma Client)
# =============================================================================
FROM dependencies AS builder

# Copy package sources and configs
COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared library and NestJS API
RUN npm run api:build

# =============================================================================
# Stage 4: Production dependencies
# =============================================================================
FROM base AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN mkdir -p apps/mobile && \
    echo '{"name": "@fieldops/mobile", "version": "0.0.0", "private": true}' > apps/mobile/package.json

# Install only production dependencies for the API and runtime workspaces
RUN npm ci \
    --workspace=@fieldops/api \
    --workspace=@fieldops/shared \
    --workspace=@fieldops/types \
    --workspace=@fieldops/config \
    --include-workspace-root \
    --omit=dev \
    --ignore-scripts

# =============================================================================
# Stage 5: Production Runner
# =============================================================================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    STORAGE_DIR=/app/apps/api/storage \
    PATH="/app/node_modules/.bin:$PATH"

# Setup storage directory and assign ownership to non-root node user
RUN mkdir -p /app/apps/api/storage && chown -R node:node /app

# Copy production node_modules (hoisted at monorepo root)
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# Copy package descriptors
COPY --chown=node:node package.json ./
COPY --chown=node:node packages/config/package.json ./packages/config/
COPY --chown=node:node packages/types/package.json ./packages/types/
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --chown=node:node apps/api/package.json ./apps/api/

# Copy compiled shared package
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist

# Copy compiled API dist and database assets
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder --chown=node:node /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder --chown=node:node /app/apps/api/scripts ./apps/api/scripts

# Copy entrypoint script
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

WORKDIR /app/apps/api

EXPOSE 3000

# Liveness health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health/live || exit 1

ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["api"]
