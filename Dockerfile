# syntax=docker/dockerfile:1
# Production image: Next.js standalone server + migrations.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S ledger && adduser -S ledger -G ledger
COPY --from=build --chown=ledger:ledger /app/.next/standalone ./
COPY --from=build --chown=ledger:ledger /app/.next/static ./.next/static
COPY --from=build --chown=ledger:ledger /app/public ./public
COPY --from=build --chown=ledger:ledger /app/drizzle ./drizzle
USER ledger
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Set MIGRATE_ON_START=true to apply pending migrations when the server boots,
# or run `npm run db:migrate` from a release step before starting new instances.
CMD ["node", "server.js"]
