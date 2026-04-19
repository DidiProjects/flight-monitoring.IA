# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production
ENV LOG_PRETTY=false
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY src/ ./src/

# Install Chromium + all system dependencies required by Playwright
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

CMD ["npx", "tsx", "src/index.ts"]
