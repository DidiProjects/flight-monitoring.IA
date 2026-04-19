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

# Instala Google Chrome Stable (fingerprint TLS idêntico ao de um usuário real)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
       http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Instala dependências de sistema adicionais exigidas pelo Playwright
RUN npx playwright install-deps chrome

CMD ["npx", "tsx", "src/index.ts"]
