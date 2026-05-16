# Agente: flight.API

Você é um agente especializado no projeto **flight.API**, localizado em `C:\Users\diego\Documents\projects\flight.API`.

## Stack

- **Runtime:** Node.js 22 + TypeScript 5.4.5
- **Framework:** Fastify 5.8.5
- **Banco:** PostgreSQL 16 (via `pg.Pool` em `src/db/pool.ts`)
- **Auth:** JWT (`@fastify/jwt`) + bcryptjs
- **Validação:** Zod 3
- **Email:** nodemailer
- **Logging:** pino + pino-loki (Grafana Loki opcional)
- **Testes:** Vitest 4
- **Build:** `tsc` → `build/`; dev com `tsx watch`

## Estrutura de pastas

```
src/
├── config/env.ts           # Zod schema das env vars
├── db/pool.ts              # pg.Pool compartilhada
├── container.ts            # DI manual (instancia repos → services → routes)
├── modules/
│   ├── auth/               # Login, JWT, password reset
│   ├── users/              # CRUD de usuários (admin)
│   ├── airlines/           # Gerenciamento de companhias
│   ├── routines/           # Regras de monitoramento
│   ├── scrape/             # Webhook recebido do scraping.API
│   ├── register/           # Solicitações de cadastro
│   └── unsubscribe/        # Descadastro de email
├── services/
│   ├── email/              # Templates HTML + SMTP
│   ├── notifications/      # Lógica de alerta + tokens de unsubscribe
│   └── scheduler/          # Loop de scraping periódico + jobs diários
└── utils/
    ├── crypto.ts           # bcrypt, tokens
    └── errors.ts           # ApiError e subclasses (BadRequest, Unauthorized, etc.)
```

## Padrão de módulo

Cada módulo em `src/modules/<domain>/` segue:
```
interfaces/I<Domain>Repository.ts
interfaces/I<Domain>Service.ts
<Domain>Repository.ts   ← SQL puro, pg.Pool
<Domain>Service.ts      ← lógica de negócio
route.ts                ← factory: (service) => FastifyPlugin
schema.ts               ← schemas Zod
```

## Convenções críticas

- **Prefixo global:** todas as rotas têm prefixo `/flight`
- **Auth:** Bearer Token (`Authorization: Bearer <jwt>`) + API Key (`x-api-key`) para o webhook do scraper
- **JWT payload:** `{ sub, role, email, mustChangePassword }`
- **Roles:** `admin | user`
- **Erro:** classe `ApiError` com `statusCode`; throw para o errorHandler tratar
- **Rate limit:** 120 req/min por IP
- **CORS:** restrito a `env.FRONTEND_URL`
- **Logging:** pino estruturado; Loki opcional via `GRAFANA_LOKI_*` env

## Rodar localmente

```bash
npm install
# Copiar .env.example para .env e preencher
npm run start:dev    # tsx watch (desenvolvimento)
npm run build        # compila para build/
npm start            # produção
npm run typecheck    # valida tipos
npm test             # vitest
```

**Pré-requisito:** PostgreSQL rodando (flight.DB iniciado via Docker)

## Integração com outros serviços

**Recebe:**
- `POST /flight/scrape/results` — webhook do `scraping.API` com ofertas de voos (header `x-api-key`)

**Envia:**
- `POST {SCRAPING_API_URL}/scrape` — dispara busca no `scraping.API` (header `x-api-key`)
- Emails via SMTP: alertas, reset de senha, senha provisória, links de unsubscribe

**Banco:** lê/escreve em todas as tabelas via repositórios (users, routines, flight_offers, best_fares, notification_log, etc.)

## Scheduler interno

- `scheduleScrapeLoop()` — a cada `SCRAPE_INTERVAL_MS` despacha scrapes para rotinas ativas
- `scheduleDailyJobs()` — jobs diários (resumos, end-of-period, etc.)
- Rotina só é despachada se não houver `pending_request_id` válido (< 1h)

## Fluxo de notificação

1. Webhook chega em `POST /flight/scrape/results`
2. `ScrapeService` processa ofertas, salva em `flight_offers`, atualiza `best_fares`
3. `NotificationService` avalia se oferta supera target (com margem)
4. Se sim, `EmailService` envia alerta para email principal + CC emails

## Modos de notificação por rotina

- `alert_only` — só alerta quando target superado
- `daily_best_and_alert` — resumo diário + alerta
- `end_of_period` — único email no horário `end_of_period_time`
