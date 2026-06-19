# Agente: flight.DB

Projeto em `C:\Users\diego\Documents\projects\flight.DB`. PostgreSQL 16 em Docker, timezone `America/Sao_Paulo`. Schema e dados do sistema de monitoramento.

## Estrutura

- `init-scripts/01-schema.sql` — DDL completo (roda **só na 1ª inicialização** do volume) · `02-seed.sh` — airlines + admin.
- `migrations/` — scripts SQL incrementais numerados (`001…`), aplicados manualmente. Sem framework de migração.
- `docker-compose.yml` · `Dockerfile`.

Banco novo = init-scripts. Banco existente = aplicar migration nova. Ao mudar schema, atualizar **ambos** (init-scripts e uma migration).

## Subir

```bash
docker compose up -d            # container flight-db, porta host 5433 → 5432
docker exec -it flight-db psql -U admin -d dev-flightDB
docker compose down -v          # ⚠ apaga o volume (perde dados)
```
Defaults `.env`: `PG_USER=admin`, `PG_PASSWORD=admin123`, `PG_DB=dev-flightDB`.

## Tabelas principais

- **Auth/usuários:** `users`, `refresh_tokens`, `password_reset_tokens`.
- **Companhias/aeroportos:** `airlines` (`code` PK), `airports` (moeda por origem).
- **Rotinas:** `routines` (origem/destino, `outbound_start/end`, `priority` cash|pts|hyb, `notification_modes` TEXT[] ⊆ {target,scheduled}, `notification_frequency`, `scheduled_time`, `margin`, targets, `cc_emails` JSONB) + `routine_airlines` (M2M rotina↔companhia).
- **Scheduler:** `scraping_jobs` — estado do agendamento, UNIQUE `(airline,origin,destination,flight_date)`, `status` ∈ {pending,running,success,failed,dead}, `priority`, `retry_count`/`max_retries`, `next_run_at`, `running_since`/`running_timeout_min`, `request_id`.
- **Dados de tarifas:** `flight_fares` (bruto, índice único parcial anti-dup por job; TTL ~30d) → `flight_fares_daily` (agregado diário). `analysis_runs` — uma linha por dispatch (status, fares_found, started/finished).
- **Notificações:** `notification_log`, `unsubscribe_tokens`.

> Legado: `flight_offers`/`best_fares` e `routine_pending_requests` ainda existem mas **não recebem dados novos** (substituídos por `scraping_jobs`/`flight_fares`). `routines` não tem mais `return_*` nem `pending_request_id`.

## Convenções

- Timestamps `TIMESTAMPTZ`. Senhas via `pgcrypto` (bcrypt). Trigger de `updated_at` = função `update_updated_at`.
- flight.API conecta via nome de serviço Docker `flight-db:5432`.
