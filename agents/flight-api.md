# Agente: flight.API

Projeto em `C:\Users\diego\Documents\projects\flight.API`. REST API (Fastify) — é o cérebro do sistema: deriva jobs de scraping, recebe os resultados por webhook, avalia ofertas contra os targets e envia alertas por email.

## Stack

Node.js 22 + TypeScript 5 + Fastify 5 · PostgreSQL (`pg.Pool`) · JWT (`@fastify/jwt`) + bcryptjs · Zod 3 · nodemailer · pino (+ pino-loki opcional) · Vitest 4. Build `tsc` → `build/`; dev `tsx watch`.

## Estrutura

- `src/config/env.ts` — env vars (Zod) · `src/db/pool.ts` — pool compartilhada · `src/container.ts` — DI manual.
- `src/modules/` — `auth`, `users`, `airlines`, `airports`, `routines`, `scrape` (webhook), `scraping-jobs`, `flight-fares`, `analysis-runs`, `register`, `unsubscribe`, `health`.
- `src/services/` — `scheduler`, `evaluation`, `notifications`, `email`.

Cada módulo: `interfaces/`, `<Domain>Repository.ts` (SQL puro), `<Domain>Service.ts` (lógica), `route.ts`, `schema.ts` (Zod).

## Convenções

- Prefixo global `/flight`. Auth Bearer JWT; webhook do scraper usa `x-api-key`.
- Erros via `ApiError` (subclasses em `utils/errors.ts`); rate limit 120/min/IP; CORS restrito a `FRONTEND_URL`.
- Schema/tabelas vivem no **flight.DB** — consultar lá; não documentar schema aqui.

## Rodar

`npm install` → `.env` (ver `.env.example`) → `npm run start:dev` (dev) · `npm run build` · `npm test` · `npm run typecheck`. Requer Postgres (flight.DB) no ar.

## Scheduler (`src/services/scheduler/`)

Opera sobre `scraping_jobs` (um job por `airline × origin × destination × flight_date`), **não por rotina**. Loops:

- **Derivação** — deriva/upserta jobs das rotinas ativas e recalcula prioridade (staleness + proximidade do voo).
- **Dispatch** — a cada `SCRAPE_INTERVAL_MS` reivindica jobs por companhia (`SKIP LOCKED`) e dispara `POST {SCRAPING_API_URL}/scrape`. Limite de `SCRAPE_DISPATCH_BATCH` jobs por companhia por tick (= sessões simultâneas no mesmo IP; mantido baixo p/ stealth). Circuit breaker por companhia.
- **Heartbeat** — recupera jobs travados em `running` (vira `dead` ao atingir `max_retries`).
- **Evaluation** (5min) e **tarefas diárias** (agregação/cleanup com catch-up).

Reagendamento após sucesso (`calcNextRunAt`): voo ≤7d → 1h · ≤14d → 2h · ≤30d → 4h · ≤60d → 6h · >60d → 12h. Jobs `success` voltam a ser elegíveis quando `next_run_at` vence.

Env de scraping: `SCRAPE_INTERVAL_MS` (300000), `SCRAPE_INTERVAL_JITTER_MS` (60000), `SCRAPE_DISPATCH_BATCH` (1).

## Fluxo de scraping/notificação

1. Dispatch cria `request_id`, marca job `running`, abre `analysis_runs` e chama o scraper.
2. Webhook `POST /flight/scrape/results` → `ScrapeService`: salva em `flight_fares`, marca sucesso/falha; bloqueio de IP pausa a companhia; callback órfão reidrata o job por id e salva as fares.
3. `EvaluationService` (5min) compara tarifas **frescas** (≤48h) contra o target (com margem); rate-limit de 24h por rotina.
4. `NotificationsService` envia alerta (target batido) e resumo agendado (`scheduled_time`, com catch-up + dedup).

## Integração

Envia: `POST {SCRAPING_API_URL}/scrape` (x-api-key) + emails SMTP. Recebe: `POST /flight/scrape/results` (x-api-key). Banco via `pg.Pool`.
