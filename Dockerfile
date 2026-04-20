# ─── Base: Ubuntu 24.04 LTS + Node.js 22 ──────────────────────────────────────
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production
ENV LOG_PRETTY=false

WORKDIR /app

# Node.js 22 + dependências do Firefox (Camoufox headless não precisa de Xvfb)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg ca-certificates \
    libgtk-3-0 libdbus-glib-1-2 libx11-xcb1 libxt6 \
    libasound2t64 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libxkbcommon0 libpango-1.0-0 libpangocairo-1.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Dependências do app + Camoufox Firefox binary (via postinstall)
COPY package*.json tsconfig.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
