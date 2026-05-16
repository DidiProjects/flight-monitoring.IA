# Feature: Múltiplas Airlines por Rotina

## Contexto

Hoje cada rotina monitora uma única airline. O objetivo é permitir que uma rotina monitore N airlines simultaneamente, disparando scrapes em paralelo e comparando os melhores preços por airline no email de notificação.

## Decisões de design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Dispatch | **Fan-out** — um POST por airline | Scrapes paralelos; scraping.API não muda |
| best_fares | **Por airline** — airline entra na constraint única | Usuário precisa saber qual airline reservar |

---

## flight.DB

### Tabelas novas

```sql
-- Substitui routines.airline (coluna escalar)
CREATE TABLE routine_airlines (
  routine_id UUID        NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  airline    VARCHAR(20) NOT NULL REFERENCES airlines(code),
  PRIMARY KEY (routine_id, airline)
);

-- Substitui pending_request_id / pending_request_at (campos escalares)
CREATE TABLE routine_pending_requests (
  routine_id   UUID        NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  airline      VARCHAR(20) NOT NULL REFERENCES airlines(code),
  request_id   UUID        NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (routine_id, airline)
);
```

### Migration completa

```sql
-- 1. Criar junction table e migrar dados existentes
CREATE TABLE routine_airlines (
  routine_id UUID        NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  airline    VARCHAR(20) NOT NULL REFERENCES airlines(code),
  PRIMARY KEY (routine_id, airline)
);
INSERT INTO routine_airlines (routine_id, airline)
  SELECT id, airline FROM routines;

-- 2. Criar tabela de rastreamento de scrapes pendentes
CREATE TABLE routine_pending_requests (
  routine_id   UUID        NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  airline      VARCHAR(20) NOT NULL REFERENCES airlines(code),
  request_id   UUID        NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (routine_id, airline)
);

-- 3. Adicionar airline em best_fares e atualizar constraint única
ALTER TABLE best_fares ADD COLUMN airline VARCHAR(20) REFERENCES airlines(code);
ALTER TABLE best_fares
  DROP CONSTRAINT best_fares_routine_id_date_is_return_fare_type_key;
ALTER TABLE best_fares
  ADD CONSTRAINT best_fares_unique
  UNIQUE (routine_id, airline, date, is_return, fare_type);

-- 4. Remover colunas obsoletas de routines
ALTER TABLE routines DROP COLUMN airline;
ALTER TABLE routines DROP COLUMN pending_request_id;
ALTER TABLE routines DROP COLUMN pending_request_at;

-- 5. Garantir FK faltante em flight_offers (airline já existe como coluna sem FK)
ALTER TABLE flight_offers
  ADD CONSTRAINT fk_flight_offers_airline
  FOREIGN KEY (airline) REFERENCES airlines(code);
```

### Detalhes não-óbvios

- `pending_request_id` hoje é escalar — com fan-out, cada airline tem seu próprio request em andamento. A `routine_pending_requests` resolve isso com PK `(routine_id, airline)`.
- `best_fares` sem `airline` na constraint causaria colisão: melhor preço da Azul e da Latam para a mesma data/direção/tipo se sobreescreveriam.
- `flight_offers.airline` já existe como coluna mas sem FK referencial — a migration adiciona a constraint.

---

## flight.API

### Tipos (`src/types/index.ts`)

- `RoutineRow.airline: string` → `airlines: string[]`

### Repositório de rotinas (`src/modules/routines/RoutinesRepository.ts`)

- `COLS`: `airline` → `airlines`
- `create()` linha 88: `data.airline` → `data.airlines` (array serializado para `TEXT[]`)
- `update()` linha 100: `colMap` entry `airline → airlines`
- `deactivateByAirline()` linha 173: `WHERE airline = $1` → `WHERE $1 = ANY(airlines)` (se mantiver coluna) ou JOIN em `routine_airlines`
- `deleteByAirline()` linha 179: idem
- `findDispatchable()`: precisa fazer JOIN em `routine_airlines` e retornar a lista de airlines por rotina

### Interface do repositório (`src/modules/routines/interfaces/IRoutinesRepository.ts`)

- `CreateRoutineData.airline: string` → `airlines: string[]`

### Schema Zod das rotas (`src/modules/routines/schema.ts`)

- `airline: z.string().min(1).max(20)` → `airlines: z.array(z.string().min(1).max(20)).min(1)`

### Scheduler (`src/services/scheduler/SchedulerService.ts`)

- `dispatchRoutine()` linhas 68-104: fan-out por airline
  - Para cada `airline` em `routine.airlines`, gerar um `requestId` separado
  - Inserir em `routine_pending_requests (routine_id, airline, request_id, requested_at)`
  - POST para scraping.API com `airline: string` (singular, como hoje)
  - Em caso de erro, remover o registro de `routine_pending_requests` (hoje: `clearPendingRequest`)
- `dispatchAll()`: a query `findDispatchable()` deve excluir rotinas que tenham **todas** as airlines com scrape pendente < 1h (ou excluir por airline individualmente — considerar fan-out parcial)
- Logs nas linhas 85, 98, 101: `airline: routine.airline` → `airlines: routine.airlines`

### Webhook — schema de entrada (`src/modules/scrape/schema.ts`)

- `flightOfferSchema`: adicionar `airline: z.string()` como campo obrigatório (scraping.API já retorna esse campo)

### Serviço de scrape (`src/modules/scrape/ScrapeService.ts`)

- Logs nas linhas 40, 55, 69, 87, 103-107: `airline: routine.airline` → `airlines: routine.airlines`
- Linha 117-123 `offersRepo.insertMany(routine.id, routine.airline, ...)`: remover parâmetro `airline` — o airline vem de cada offer individualmente (`offer.airline`)
- Ao receber o resultado, remover o registro de `routine_pending_requests (routine_id, airline)` onde `airline = result.airline`

### Repositório de offers (`src/modules/scrape/FlightOffersRepository.ts`)

- `insertMany()` linha 18-21: remover parâmetro `airline: string`; cada offer carrega `offer.airline`
- Linha 39: valor `$2` muda de variável externa para `offer.airline`

### Repositório de best fares (`src/modules/scrape/BestFaresRepository.ts`)

- `upsertFromOffers()`: constraint única agora inclui `airline` — a lógica de upsert precisa incluir `airline` na cláusula `ON CONFLICT`
- `getBest()`: pode buscar o melhor global (melhor entre todas airlines) ou por airline. Para notificações que mostram comparativo por airline, criar `getBestByAirline(routineId, airline, isReturn, priority)` ou adaptar `getBest` para aceitar `airline?: string`.

### Serviço de notificações (`src/services/notifications/NotificationsService.ts`)

- Logs: `airline: routine.airline` → `airlines: routine.airlines` (linhas 34, 106, 125, 157, 196)
- `sendFlightAlert({ airline: routine.airline })` linha 189: definir como exibir no email — opções:
  - Mostrar airline do `bestOut.offer.airline` (a que encontrou o melhor preço)
  - Mostrar todas as airlines monitoradas
- Se quiser mostrar comparativo por airline no email: iterar `routine.airlines`, chamar `getBestByAirline` para cada uma e construir um bloco por airline

---

## flight.FRONT

### Tipos (`src/types/routines.ts`)

- Linha 11: `airline: string` → `airlines: string[]`
- Tipos derivados `CreateRoutineRequest` e `UpdateRoutineRequest` herdam automaticamente via `Omit`/`Partial`

### Schema Zod (`src/utils/schemas.ts`)

- Linha 62: `airline: z.string().min(1, 'Companhia obrigatória')` → `airlines: z.array(z.string()).min(1, 'Selecione ao menos uma companhia')`

### Formulário (`src/components/organisms/RoutineForm/index.tsx`)

| Linha | Mudança |
|-------|---------|
| 62 | `EMPTY.airline: ''` → `EMPTY.airlines: []` |
| 118 | `airline: routine.airline` → `airlines: routine.airlines` |
| 140-153 | Effects de inicialização: adaptar para arrays |
| 157-170 | Effect de sync currency/prioridade: `selectedAirline` → `selectedAirlines` (array filtrado); lógica de `has_cash/pts/hyb` passa a ser union ou intersection das airlines selecionadas |
| 203 | `airlines.find(a => a.code === form.airline)` → `airlines.filter(a => form.airlines.includes(a.code))` |
| 242-255 | `<FormField select>` single-select → multi-select (MUI `Select` com `multiple` ou chips toggleáveis) |
| 381-383 | Capacidades `has_cash/pts/hyb` calculadas sobre todas as airlines selecionadas |

### Card do dashboard (`src/components/molecules/RoutineCard/index.tsx`)

- Linha 64: `routine.airline.toUpperCase()` → `routine.airlines.map(a => a.toUpperCase()).join(' · ')`

### Service (`src/services/RoutinesService.ts`)

- Linha 23 `fromApi()`: `airline: raw.airline` → `airlines: raw.airlines ?? (raw.airline ? [raw.airline] : [])` (fallback de retrocompatibilidade)

---

## scraping.API

**Nenhuma alteração necessária.** O fan-out garante que a scraping.API continua recebendo um `airline` por request, exatamente como hoje.

---

## Ordem de implementação sugerida

1. **flight.DB** — rodar a migration (sem isso nada funciona)
2. **flight.API** — atualizar tipos, repositórios, scheduler e webhook
3. **flight.FRONT** — atualizar tipos, form e card
4. Deploy e smoke test end-to-end

---

## Pontos de atenção

- **Retrocompatibilidade da API**: ao mudar `airline` → `airlines` no contrato REST, o FRONT antigo quebraria. Fazer o deploy de FRONT e API juntos (ou aceitar `airline` como fallback temporário na API).
- **Rotinas existentes**: a migration migra os dados (`INSERT INTO routine_airlines SELECT id, airline FROM routines`) — todas as rotinas existentes ficam com uma airline, sem quebra de dados.
- **Email template**: decidir se o `EmailService` recebe um bloco por airline ou o melhor global. Pode requerer ajuste no template HTML de notificação.
- **fan-out parcial**: uma rotina com 3 airlines pode ter 1 airline com scrape concluído e 2 ainda pendentes. O scheduler deve poder despachar as airlines sem scrape pendente sem esperar as demais terminarem.
