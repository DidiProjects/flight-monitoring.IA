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
ENV DISPLAY=:99

WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY src/ ./src/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Instala Google Chrome Stable (fingerprint TLS idêntico ao de um usuário real)
# + Xvfb para display virtual (permite headless:false em container sem GPU)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates xvfb \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
       | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
       http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# Instala dependências de sistema adicionais exigidas pelo rebrowser-playwright
RUN npx rebrowser-playwright install-deps chromium

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
