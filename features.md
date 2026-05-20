# Feature: Frequência de Scraping por Rotina

## Contexto

Hoje todas as rotinas ativas são despachadas juntas em todo ciclo do scheduler (controlado globalmente por `SCRAPE_INTERVAL_MS`). Não há como configurar "scrape essa rotina a cada 1h, essa outra a cada 6h". O campo `notificationFrequency` controla apenas o envio de email — o scraping roda em todas as rotinas indiscriminadamente.

## Decisões de design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Controle de cadência | `last_dispatched_at` na tabela `routines` + `scrape_frequency` enum | Simples, sem nova tabela; o scheduler compara `now() - last_dispatched_at >= intervalo` |
| Enum de frequência | `hourly`, `every_6h`, `daily` | Cobre os casos de uso reais sem complexidade de cron customizado |
| Fallback | `hourly` como default | Mantém comportamento atual para rotinas existentes sem migração de dados |

---

## flight.DB

### Migration

```sql
BEGIN;

CREATE TYPE scrape_frequency AS ENUM ('hourly', 'every_6h', 'daily');

ALTER TABLE routines
  ADD COLUMN scrape_frequency scrape_frequency NOT NULL DEFAULT 'hourly',
  ADD COLUMN last_dispatched_at TIMESTAMPTZ;

COMMIT;
```

### Detalhes não-óbvios

- `last_dispatched_at` é `NULL` para rotinas nunca despachadas — o scheduler deve tratar `NULL` como elegível.
- O intervalo efetivo em segundos: `hourly = 3600`, `every_6h = 21600`, `daily = 86400`.
- `scrape_frequency` é independente de `notification_frequency` — uma rotina pode fazer scrape diário mas enviar email mensal.

---

## flight.API

### Tipos (`src/types/index.ts`)

- `RoutineRow`: adicionar `scrape_frequency: 'hourly' | 'every_6h' | 'daily'` e `last_dispatched_at: Date | null`

### Schema Zod (`src/modules/routines/schema.ts`)

- `routineBaseSchema`: adicionar `scrapeFrequency: z.enum(['hourly', 'every_6h', 'daily']).default('hourly')`

### Interface do repositório (`src/modules/routines/interfaces/IRoutinesRepository.ts`)

- `CreateRoutineData`: adicionar `scrapeFrequency: 'hourly' | 'every_6h' | 'daily'`
- `findDispatchable()`: filtrar por `last_dispatched_at IS NULL OR now() - last_dispatched_at >= intervalo(scrape_frequency)`
- Novo método `setLastDispatched(id: string): Promise<void>` — atualiza `last_dispatched_at = now()`

### Query `findDispatchable` atualizada

```sql
SELECT ...
FROM routines r
JOIN routine_airlines ra ON ra.routine_id = r.id
LEFT JOIN routine_pending_requests rpr ON rpr.routine_id = r.id AND rpr.airline = ra.airline
WHERE r.is_active = true
  AND (
    r.last_dispatched_at IS NULL
    OR (r.scrape_frequency = 'hourly'    AND r.last_dispatched_at < now() - INTERVAL '1 hour')
    OR (r.scrape_frequency = 'every_6h'  AND r.last_dispatched_at < now() - INTERVAL '6 hours')
    OR (r.scrape_frequency = 'daily'     AND r.last_dispatched_at < now() - INTERVAL '1 day')
  )
GROUP BY r.id
HAVING COUNT(ra.airline) FILTER (
  WHERE rpr.request_id IS NULL OR rpr.requested_at < now() - INTERVAL '1 hour'
) > 0
```

### Scheduler (`src/services/scheduler/SchedulerService.ts`)

- `dispatchRoutine()`: chamar `routinesRepo.setLastDispatched(routine.id)` após disparar todas as airlines com sucesso

### Rotas (`src/modules/routines/route.ts`)

- POST e PATCH: incluir `scrapeFrequency: body.scrapeFrequency`

---

## flight.FRONT

### Tipos (`src/types/routines.ts`)

- `Routine`: adicionar `scrapeFrequency: 'hourly' | 'every_6h' | 'daily'`

### Schema Zod (`src/utils/schemas.ts`)

- `routineSchema`: adicionar `scrapeFrequency: z.enum(['hourly', 'every_6h', 'daily'])`

### Formulário (`src/components/organisms/RoutineForm/index.tsx`)

- `EMPTY`: `scrapeFrequency: 'hourly'`
- Seção de notificações: adicionar `<FormField select>` para `scrapeFrequency` ao lado ou abaixo de `notificationFrequency`
  - `hourly` — A cada hora
  - `every_6h` — A cada 6 horas
  - `daily` — Uma vez por dia

---

## Ordem de implementação

1. **flight.DB** — rodar a migration
2. **flight.API** — tipos, schema, repositório, scheduler
3. **flight.FRONT** — tipos, schema, formulário
4. Deploy e validar que rotinas existentes continuam com `hourly` (default)

---

## Pontos de atenção

- O `SCRAPE_INTERVAL_MS` global continua sendo o tick do loop — deve ser menor que o menor `scrape_frequency` (ex: 30min) para que a checagem funcione corretamente.
- Rotinas com `scrapeFrequency = 'daily'` combinadas com `notificationFrequency = 'hourly'` fazem sentido: o scrape roda uma vez por dia, mas se o preço baixar, o email sai imediatamente.
- `last_dispatched_at` é por rotina, não por airline — todas as airlines de uma rotina são despachadas juntas no mesmo ciclo dela.
