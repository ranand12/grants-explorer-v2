FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Leave NEXT_PUBLIC_AGENT_URL empty to use the same-origin /agent proxy (recommended)
ARG NEXT_PUBLIC_AGENT_URL=""
ENV NEXT_PUBLIC_AGENT_URL=$NEXT_PUBLIC_AGENT_URL

RUN npm run build && npm prune --omit=dev

# ── Production stage ──
# Runs server.mjs (Next.js + /agent proxy for REST, SSE and the /live WebSocket)
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# Where the Python agent lives (e.g. its Cloud Run URL); read at runtime
ENV AGENT_URL="http://localhost:8001/"

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/server.mjs ./

EXPOSE 8080

CMD ["node", "server.mjs"]
