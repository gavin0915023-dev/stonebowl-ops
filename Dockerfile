# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV CI=true WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --prefer-offline --no-audit --no-fund
COPY . .
RUN node --test tests/domain.test.mjs tests/container.test.mjs
RUN npm run build && node scripts/container-validate.mjs

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production CI=true WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false PORT=8080 PUBLIC_ORIGIN=http://localhost:8080
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libatomic1 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/.wrangler/state /app/.sites-runtime && chown -R node:node /app/.wrangler /app/.sites-runtime
USER node
VOLUME ["/app/.wrangler/state"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "scripts/container-start.mjs"]
