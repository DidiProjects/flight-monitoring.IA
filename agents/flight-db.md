# Agente: flight.DB

Você é um agente especializado no projeto **flight.DB**, localizado em `C:\Users\diego\Documents\projects\flight.DB`.

## Stack

- **Banco:** PostgreSQL 16
- **Timezone:** `America/Sao_Paulo` (configurado no Dockerfile e no schema)
- **Infraestrutura:** Docker + Docker Compose
- **Deploy:** GitHub Actions → Tailscale + SSH + rsync

## Estrutura de pastas

```
flight.DB/
├── init-scripts/
│   ├── 01-schema.sql   # DDL completo (8 tabelas + indexes + triggers)
│   └── 02-seed.sh      # Seed: airlines (Azul) + admin inicial
├── migrations/         # Scripts incrementais (sem framework formal)
├── backup/             # SQL dumps manuais
├── Dockerfile          # PostgreSQL 16 + init scripts
└── docker-compose.yaml
```

**Init scripts** rodam apenas na **primeira inicialização do volume Docker**. Nas execuções seguintes, o volume já existe e os scripts são ignorados.

## Schema completo (8 tabelas)

### `users`
- `id` UUID PK, `email` UK, `name`, `password_hash`
- `role` CHECK IN ('admin', 'user')
- `status` CHECK IN ('pending', 'active', 'suspended')
- `must_change_password` BOOLEAN
- `provisional_expires_at` TIMESTAMPTZ (senha provisória expira em 24h)
- Trigger: `trg_users_updated_at`

### `refresh_tokens`
- `id` UUID PK, `user_id` FK users, `token` UK
- `expires_at` TIMESTAMPTZ

### `password_reset_tokens`
- `id` UUID PK, `user_id` FK users, `token` UK
- `expires_at` TIMESTAMPTZ, `used_at` TIMESTAMPTZ

### `airlines`
- `code` VARCHAR(20) PK (ex: `"azul"`), `name`, `is_active`

### `routines`
- `id` UUID PK, `user_id` FK users, `airline` FK airlines
- `origin`, `destination` (IATA codes)
- `outbound_start/end`, `return_start/end` DATE (range de datas monitoradas)
- `passengers` INT
- `priority` CHECK IN ('cash', 'pts', 'hyb')
- `target_cash`, `target_pts`, `target_hyb_pts`, `target_hyb_cash` NUMERIC (pelo menos um deve ser preenchido — constraint `at_least_one_target`)
- `target_margin_pct` NUMERIC (% abaixo do target para alertar)
- `notification_mode` CHECK IN ('alert_only', 'daily_best_and_alert', 'end_of_period')
- `notification_frequency` CHECK IN ('hourly', 'daily', 'monthly')
- `end_of_period_time` TIME
- `cc_emails` JSONB — `[{ "email": "...", "subscribed": true }]`
- `is_active` BOOLEAN
- `pending_request_id` UUID — rastreia scrape em andamento
- `pending_request_at` TIMESTAMPTZ — expirado se > 1h
- Trigger: `trg_routines_updated_at`

### `flight_offers`
- `id` UUID PK, `routine_id` FK routines
- `flight_number`, `date` DATE, `is_return` BOOLEAN
- `origin`, `destination`, `departure_time`, `arrival_time`
- `duration_min` INT, `stops` INT
- `fare_cash`, `fare_pts`, `fare_hyb_pts`, `fare_hyb_cash` NUMERIC (nullable — pelo menos um preenchido)
- `within_target` BOOLEAN (pré-calculado na ingestão)
- `scraped_at` TIMESTAMPTZ

### `best_fares`
- `id` UUID PK, `routine_id` FK routines, `flight_offer_id` FK flight_offers
- `date` DATE, `is_return` BOOLEAN
- `fare_type` CHECK IN ('cash', 'pts', 'hyb')
- `fare_value` NUMERIC
- UNIQUE `(routine_id, date, is_return, fare_type)` — garante dedup
- Trigger: `trg_best_fares_updated_at`

### `notification_log`
- `id` UUID PK, `routine_id` FK routines
- `sent_at` TIMESTAMPTZ, `type` VARCHAR, `details` JSONB

### `unsubscribe_tokens`
- `id` UUID PK, `routine_id` FK routines
- `token` UK, `email` VARCHAR
- `is_primary` BOOLEAN — se true, desativa a rotina; se false, atualiza cc_emails
- `expires_at` TIMESTAMPTZ (1h após envio)
- `used_at` TIMESTAMPTZ

## Indexes (10 total)

```sql
idx_refresh_token, idx_pw_reset_token, idx_unsubscribe_token
idx_routines_user_id, idx_routines_is_active
idx_flight_offers_routine_id, idx_flight_offers_date, idx_flight_offers_scraped_at
idx_best_fares_routine_id
idx_notif_log_routine_id, idx_notif_log_sent_at
```

## Subir localmente

```bash
# .env na raiz:
PG_USER=admin
PG_PASSWORD=admin123
PG_DB=dev-flightDB
ADMIN_EMAIL=admin@flight.local
ADMIN_INITIAL_PASSWORD=changeme123

docker compose up            # inicia (primeira vez roda init scripts)
docker compose down          # para (volume persiste)
docker compose down -v       # para e deleta volume (⚠ perde dados)

# Conectar
docker exec -it flight-db psql -U admin -d dev-flightDB

# Backup
docker exec -t flight-db pg_dump -U admin -d dev-flightDB > backup/flight_backup.sql

# Restore
cat backup/flight_backup.sql | docker exec -i flight-db psql -U admin -d dev-flightDB
```

## Convenções críticas

- **Sem framework de migração formal** — schema versionado como arquivo SQL único; alterações via scripts em `migrations/`
- **Idempotência no seed:** `ON CONFLICT DO NOTHING` em todos os inserts
- **Timestamps:** sempre `TIMESTAMPTZ` com timezone `America/Sao_Paulo`
- **Senha no seed:** `crypt(password, gen_salt('bf', 12))` via `pgcrypto` — nunca plain text
- **Port mapping:** container expõe `5433` → interno `5432`; flight.API conecta via `flight-db:5432` (nome de serviço Docker)
- **User Docker:** roda como `postgres` (UID 999), não root
- **Extensão obrigatória:** `pgcrypto` (bcrypt para senhas)

## Detalhes não-óbvios do schema

- `routines.pending_request_id/at` — evita double-dispatch; scheduler ignora rotina com request pendente < 1h
- `best_fares` — mantém as 100 melhores tarifas por `(routine, date, direction, fare_type)`; atualiza `flight_offer_id` se preço novo for menor
- `cc_emails` JSONB — desinscrição marca `subscribed: false` sem deletar o registro
- `unsubscribe_tokens.is_primary` — controla se desinscrição desativa a rotina inteira ou só remove um CC email
- `flight_offers.within_target` — calculado ao ingerir (evita recálculo em queries)
